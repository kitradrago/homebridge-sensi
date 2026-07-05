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

interface QueuedCommand {
  frame: string;
  queuedAt: number;
}

export class SensiAPI {
  private readonly oauthUrl = "https://oauth.sensiapi.io/token";
  private readonly wsUrl =
    "wss://rt.sensiapi.io/thermostat/?transport=websocket";

  private refreshToken: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0; // epoch ms; 0 = unknown

  private ws: WebSocket | null = null;
  private handshakeComplete = false;
  private listeners: Set<DeviceUpdateListener> = new Set();
  private reconnecting = false;

  private serverPingIntervalMs = 25000;
  private serverPingTimeoutMs = 20000;
  private watchdog: NodeJS.Timeout | null = null;

  // Commands issued while disconnected are queued briefly and flushed on
  // (re)connect instead of being dropped on the floor.
  private commandQueue: QueuedCommand[] = [];
  private readonly commandQueueTtlMs = 30000;

  constructor(
    refreshToken: string,
    private readonly log: Logging,
  ) {
    this.refreshToken = refreshToken;
  }

  // ---------------------------------------------------------------- auth ---

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

      // Track expiry so we can refresh proactively instead of waiting for
      // the server to reject/drop us with a stale token.
      if (
        typeof resp.data.expires_in === "number" &&
        resp.data.expires_in > 0
      ) {
        this.tokenExpiresAt = Date.now() + resp.data.expires_in * 1000;
      } else {
        this.tokenExpiresAt = 0;
      }

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

  private tokenIsFresh(): boolean {
    if (!this.accessToken) return false;
    if (this.tokenExpiresAt === 0) return true; // unknown expiry, assume ok
    return Date.now() < this.tokenExpiresAt - 60_000; // 60s safety margin
  }

  private wsHeaders(): Record<string, string> {
    return { Authorization: `bearer ${this.accessToken}` };
  }

  // ---------------------------------------------------------- connection ---

  async connect(): Promise<void> {
    if (!this.tokenIsFresh()) {
      await this.authenticate();
    }

    // Tear down any existing socket. We do NOT rely on a shared instance
    // flag to suppress its close event — every event handler below is
    // guarded by socket identity instead (see `socket !== this.ws` checks),
    // which cannot be stranded in a wrong state the way a boolean can.
    this.teardownSocket();

    const socket = new WebSocket(this.wsUrl, { headers: this.wsHeaders() });
    this.ws = socket;
    this.handshakeComplete = false;

    socket.on("open", () => {
      if (socket !== this.ws) return; // stale socket, ignore
      this.log.info(
        "[Sensi] WebSocket transport connected, awaiting engine.io handshake",
      );
      // Watchdog starts immediately: if the handshake never arrives, we
      // still want to detect the dead connection and retry.
      this.resetWatchdog();
    });

    socket.on("message", (data) => {
      if (socket !== this.ws) return;
      this.resetWatchdog(); // any inbound traffic proves liveness
      this.handleMessage(data);
    });

    socket.on("pong", () => {
      if (socket !== this.ws) return;
      this.resetWatchdog();
    });

    socket.on("close", (code) => {
      if (socket !== this.ws) return; // an old socket we already replaced
      this.log.warn(`[Sensi] WebSocket closed (code ${code})`);
      this.scheduleReconnect("closed");
    });

    socket.on("error", (err) => {
      if (socket !== this.ws) return;
      this.log.error(
        "[Sensi] WebSocket error:",
        err instanceof Error ? err.message : String(err),
      );
      this.scheduleReconnect("error");
    });
  }

  /** Remove and forcibly terminate the current socket without side effects. */
  private teardownSocket(): void {
    this.stopWatchdog();
    const old = this.ws;
    this.ws = null; // identity guards in old handlers now no-op
    this.handshakeComplete = false;
    if (old) {
      try {
        old.removeAllListeners();
        // terminate() rather than close(): close() performs a graceful
        // shutdown handshake that can hang on a half-open connection,
        // which is exactly the situation we're usually in here.
        old.terminate();
      } catch (e) {
        this.log.debug("[Sensi] Error terminating old WebSocket:", e);
      }
    }
  }

  // ------------------------------------------------------------ watchdog ---

  /**
   * Liveness watchdog. The server pings us every `pingInterval` ms and
   * expects a pong within `pingTimeout` ms; symmetrically, if WE hear
   * nothing (no ping, no state, no pong) for pingInterval + pingTimeout,
   * the connection is dead even if readyState still claims OPEN. This is
   * the half-open-TCP case (common on WiFi) where no 'close' event will
   * ever fire on its own.
   */
  private resetWatchdog(): void {
    this.stopWatchdog();
    const timeoutMs =
      this.serverPingIntervalMs + this.serverPingTimeoutMs + 5000;
    this.watchdog = setTimeout(() => {
      this.log.warn(
        `[Sensi] No traffic from server in ${Math.round(timeoutMs / 1000)}s — connection presumed dead`,
      );
      this.scheduleReconnect("watchdog timeout");
    }, timeoutMs);
  }

  private stopWatchdog(): void {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  // ------------------------------------------------------------ messages ---

  private async handleMessage(raw: WebSocket.Data): Promise<void> {
    const msg = typeof raw === "string" ? raw : raw.toString("utf-8");

    // engine.io "open" handshake: '0' + JSON {sid, pingInterval, pingTimeout}.
    // We must reply '40' to join the default socket.io namespace.
    if (msg.startsWith("0{")) {
      try {
        const handshake = JSON.parse(msg.slice(1));
        if (typeof handshake.pingInterval === "number") {
          this.serverPingIntervalMs = handshake.pingInterval;
        }
        if (typeof handshake.pingTimeout === "number") {
          this.serverPingTimeoutMs = handshake.pingTimeout;
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

    // socket.io namespace connect ack — connection is now fully live.
    if (msg.startsWith("40")) {
      this.log.info("[Sensi] Socket.io handshake complete, connection live");
      this.handshakeComplete = true;
      this.flushCommandQueue();
      return;
    }

    // engine.io ping — must answer '3' or the server drops us.
    if (msg === "2") {
      this.ws?.send("3");
      return;
    }

    // socket.io namespace disconnect frame
    if (msg === "41") {
      this.log.warn("[Sensi] Server sent disconnect frame.");
      this.scheduleReconnect("server disconnect");
      return;
    }

    // socket.io error frame — most commonly auth/token rejection here.
    if (msg.startsWith("44")) {
      this.log.warn(
        "[Sensi] Server error frame (likely token expired). Refreshing...",
      );
      this.accessToken = null; // force re-auth on reconnect
      this.scheduleReconnect("auth error", 1000);
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

  // ----------------------------------------------------------- reconnect ---

  private scheduleReconnect(reason: string, delayMs = 10000): void {
    if (this.reconnecting) return;
    this.reconnecting = true;

    // Kill the current socket immediately so nothing else fires from it
    // and commands start queueing rather than going into a dead pipe.
    this.teardownSocket();

    this.log.warn(
      `[Sensi] Scheduling reconnect in ${Math.round(delayMs / 1000)}s (reason: ${reason})`,
    );
    setTimeout(async () => {
      this.reconnecting = false;
      try {
        if (!this.tokenIsFresh()) {
          await this.authenticate();
        }
        await this.connect();
      } catch (e) {
        this.log.error(
          "[Sensi] Reconnect failed:",
          e instanceof Error ? e.message : String(e),
        );
        // Try again — this self-perpetuates until a connect succeeds.
        this.scheduleReconnect("retry after failure", 30000);
      }
    }, delayMs);
  }

  // ------------------------------------------------------------- commands ---

  onDeviceUpdate(listener: DeviceUpdateListener): void {
    this.listeners.add(listener);
  }

  private connectionReady(): boolean {
    return (
      this.ws !== null &&
      this.ws.readyState === WebSocket.OPEN &&
      this.handshakeComplete
    );
  }

  private sendSet(json: any): void {
    const frame = "42" + JSON.stringify(json);

    if (this.connectionReady()) {
      this.ws!.send(frame);
      this.log.debug("[Sensi] Command sent:", JSON.stringify(json));
      return;
    }

    // Not connected (or mid-handshake): queue briefly instead of dropping.
    this.commandQueue.push({ frame, queuedAt: Date.now() });
    this.log.warn(
      "[Sensi] Connection not ready — queued command:",
      JSON.stringify(json),
    );

    // If we're sitting idle with no reconnect in flight, kick one off now
    // rather than waiting for a watchdog/close that may never come.
    if (!this.reconnecting) {
      this.scheduleReconnect("command while disconnected", 0);
    }
  }

  private flushCommandQueue(): void {
    if (this.commandQueue.length === 0) return;
    const now = Date.now();
    const fresh = this.commandQueue.filter(
      (c) => now - c.queuedAt < this.commandQueueTtlMs,
    );
    const expired = this.commandQueue.length - fresh.length;
    this.commandQueue = [];

    if (expired > 0) {
      this.log.warn(`[Sensi] Discarded ${expired} stale queued command(s)`);
    }
    for (const cmd of fresh) {
      this.ws?.send(cmd.frame);
      this.log.info("[Sensi] Flushed queued command:", cmd.frame.slice(2));
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
