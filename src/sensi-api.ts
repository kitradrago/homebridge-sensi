import axios from "axios";
import WebSocket from "ws";
import { Logging } from "homebridge";

export interface DeviceStatePacket {
  icd_id: string;
  registration?: { name?: string; product_type?: string };
  state?: any;
  capabilities?: Record<string, any>;
}

export type DeviceUpdateListener = (device: DeviceStatePacket) => void;

export class SensiAPI {
  private readonly oauthUrl = "https://oauth.sensiapi.io/token";
  private readonly wsUrl =
    "wss://rt.sensiapi.io/thermostat/?transport=websocket";

  private refreshToken: string;
  private accessToken: string | null = null;
  private ws: WebSocket | null = null;
  private listeners: Set<DeviceUpdateListener> = new Set();
  private reconnecting = false;
  private closingIntentionally = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private serverPingIntervalMs = 25000;

  constructor(
    refreshToken: string,
    private readonly log: Logging,
  ) {
    this.refreshToken = refreshToken;
  }

  async authenticate(): Promise<void> {
    try {
      const form = new URLSearchParams();
      form.set("client_id", "fleet");
      form.set(
        "client_secret",
        "JLFjJmketRhj>M9uoDhusYKyi?zUyNqhGB)H2XiwLEF#KcGKrRD2JZsDQ7ufNven",
      );
      form.set("grant_type", "refresh_token");
      form.set("refresh_token", this.refreshToken);

      const resp = await axios.post(this.oauthUrl, form.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
          Accept: "*/*",
        },
        timeout: 10000,
      });

      if (!resp.data || typeof resp.data.access_token !== "string") {
        throw new Error("Invalid response: missing or malformed access_token");
      }

      this.accessToken = resp.data.access_token;

      // Only rotate the refresh token if the server actually sent a new one.
      // Overwriting with undefined bricks all future re-auths until restart.
      if (
        typeof resp.data.refresh_token === "string" &&
        resp.data.refresh_token.length > 0
      ) {
        this.refreshToken = resp.data.refresh_token;
      }

      this.log.info("[Sensi] OAuth success: access token acquired");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error("[Sensi] Authentication failed:", errorMsg);
      throw error;
    }
  }

  private wsHeaders(): Record<string, string> {
    return { Authorization: `bearer ${this.accessToken}` };
  }

  async connect(): Promise<void> {
    if (!this.accessToken) await this.authenticate();

    // Close existing connection cleanly
    this.closeWebSocket();

    this.ws = new WebSocket(this.wsUrl, { headers: this.wsHeaders() });
    this.ws.on("open", () => {
      this.log.info(
        "[Sensi] WebSocket transport connected, awaiting engine.io handshake",
      );
      // Keep-alive is started only after the socket.io namespace handshake
      // completes (see handleMessage's handling of the '0' packet below).
    });
    this.ws.on("message", (data) => this.handleMessage(data));
    this.ws.on("close", () => {
      if (this.closingIntentionally) {
        this.closingIntentionally = false;
        return;
      }
      this.scheduleReconnect("closed");
    });
    this.ws.on("error", (err) => {
      this.log.error(
        "[Sensi] WebSocket error:",
        err instanceof Error ? err.message : String(err),
      );
      this.scheduleReconnect("error");
    });
  }

  private closeWebSocket(): void {
    if (this.ws) {
      // Prevent the old socket's own 'close' handler from firing a
      // redundant reconnect — this was previously causing a
      // connect -> drop -> reconnect churn loop.
      this.closingIntentionally = true;
      try {
        this.ws.removeAllListeners();
        if (
          this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING
        ) {
          this.ws.close();
        }
      } catch (e) {
        this.log.debug("[Sensi] Error closing WebSocket:", e);
      }
      this.ws = null;
    }
    this.stopKeepAlive();
  }

  private async handleMessage(raw: WebSocket.Data): Promise<void> {
    const msg = typeof raw === "string" ? raw : raw.toString("utf-8");

    // engine.io "open" handshake packet: '0' + JSON with sid/pingInterval/etc.
    // The client MUST reply with '40' to connect to the default socket.io
    // namespace. Without this reply the transport looks "connected" but the
    // server never considers the client actually joined — it will silently
    // drop the socket once its own pingInterval/pingTimeout elapses, with no
    // error on our side. This was the actual cause of the ~90s-later drops.
    if (msg.startsWith("0{")) {
      try {
        const handshake = JSON.parse(msg.slice(1));
        if (typeof handshake.pingInterval === "number") {
          this.serverPingIntervalMs = handshake.pingInterval;
        }
      } catch (e) {
        this.log.debug(
          "[Sensi] Failed to parse engine.io handshake payload:",
          e,
        );
      }
      this.ws?.send("40");
      return;
    }

    // engine.io/socket.io namespace connect ack — handshake is now fully
    // complete and it's safe to start our keep-alive loop.
    if (msg.startsWith("40")) {
      this.log.info("[Sensi] Socket.io handshake complete, connection live");
      this.startKeepAlive();
      return;
    }

    // engine.io protocol-level ping — server expects a "3" (pong) reply.
    // Without this, the server considers the client dead and drops the
    // socket on its own ping-timeout, causing periodic disconnects.
    if (msg === "2") {
      this.ws?.send("3");
      return;
    }

    // engine.io "noop"/disconnect frame
    if (msg === "41") {
      this.log.warn("[Sensi] Server sent disconnect frame.");
      this.scheduleReconnect("server disconnect");
      return;
    }

    if (msg.startsWith("44")) {
      this.log.warn("[Sensi] Token expired. Refreshing...");
      await this.reconnectWithNewToken();
      return;
    }

    if (!msg.startsWith("42")) return;

    try {
      const payload = JSON.parse(msg.slice(2));
      const event = payload[0];
      const data = payload[1];

      if (event === "state" && Array.isArray(data)) {
        for (const device of data as DeviceStatePacket[]) {
          for (const l of this.listeners) l(device);
        }
      }
    } catch (e) {
      this.log.error(
        "[Sensi] Failed to parse WS message:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  private async reconnectWithNewToken(): Promise<void> {
    try {
      await this.authenticate();
      await this.connect();
    } catch (e) {
      this.log.error(
        "[Sensi] Reconnect failed:",
        e instanceof Error ? e.message : String(e),
      );
      this.scheduleReconnect("auth failed");
    }
  }

  private scheduleReconnect(reason: string): void {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.stopKeepAlive();
    this.log.warn(`[Sensi] Scheduling reconnect due to ${reason}`);
    setTimeout(async () => {
      this.reconnecting = false;
      try {
        await this.reconnectWithNewToken();
      } catch (e) {
        this.log.error(
          "[Sensi] Retry reconnect failed:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }, 10000); // 10s backoff
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    // Use a raw WS ping as a belt-and-suspenders connection check; the real
    // engine.io keep-alive is driven by the server's '2' pings, which we
    // answer with '3' in handleMessage(). Interval is derived from the
    // server's handshake so it never runs slower than the server expects.
    const intervalMs = Math.min(this.serverPingIntervalMs, 30000);
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        this.log.debug("[Sensi] Sent keep-alive ping");
      }
    }, intervalMs);
  }

  private stopKeepAlive(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  onDeviceUpdate(listener: DeviceUpdateListener): void {
    this.listeners.add(listener);
  }

  // Send commands using socket.io protocol
  private sendSet(json: any): void {
    // socket.io emit frame: '42' + JSON.stringify([event, data])
    const frame = "42" + JSON.stringify(json);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(frame);
      this.log.debug("[Sensi] Command sent:", JSON.stringify(json));
    } else {
      this.log.warn(
        "[Sensi] WS not open. Dropping command:",
        JSON.stringify(json),
      );
    }
  }

  setTemperature(
    icdId: string,
    temp: number,
    mode: string,
    scale: string,
  ): void {
    this.sendSet([
      "set_temperature",
      { icd_id: icdId, target_temp: temp, mode, scale },
    ]);
  }

  setMode(icdId: string, value: string): void {
    this.sendSet(["set_operating_mode", { icd_id: icdId, value }]);
  }

  setFanMode(icdId: string, value: string): void {
    this.sendSet(["set_fan_mode", { icd_id: icdId, value }]);
  }

  setCirculatingFan(icdId: string, enabled: boolean, dutyCycle: number): void {
    this.sendSet([
      "set_circulating_fan",
      {
        icd_id: icdId,
        value: { enabled: enabled ? "on" : "off", duty_cycle: dutyCycle },
      },
    ]);
  }
}
