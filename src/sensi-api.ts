import axios from "axios";
import { io, Socket } from "socket.io-client";
import { Logging } from "homebridge";

export interface DeviceStatePacket {
  icd_id: string;
  registration?: { name?: string; product_type?: string };
  state?: any;
  capabilities?: Record<string, any>;
}

export type DeviceUpdateListener = (device: DeviceStatePacket) => void;

interface QueuedCommand {
  event: string;
  data: any;
  queuedAt: number;
}

export class SensiAPI {
  private readonly oauthUrl = "https://oauth.sensiapi.io/token";

  // Matches the query string used by the reference Home Assistant
  // integration (iprak/sensi), which connects successfully against this
  // same endpoint. Kept even though it alone didn't turn out to be
  // sufficient — the real fix is using a proper socket.io client (below)
  // instead of a hand-rolled implementation of the wire protocol, but
  // there's no harm in still declaring capabilities the way the working
  // client does.
  private readonly capabilities =
    "display_humidity,operating_mode_settings,fan_mode_settings,indoor_equipment," +
    "outdoor_equipment,indoor_stages,outdoor_stages,continuous_backlight,degrees_fc,display_time," +
    "keypad_lockout,temp_offset,compressor_lockout,boost,heat_cycle_rate,heat_cycle_rate_steps," +
    "cool_cycle_rate,cool_cycle_rate_steps,aux_cycle_rate,aux_cycle_rate_steps,early_start," +
    "min_heat_setpoint,max_heat_setpoint,min_cool_setpoint,max_cool_setpoint,circulating_fan," +
    "humidity_control,humidity_offset,humidity_offset_lower_bound,humidity_offset_upper_bound," +
    "temp_offset_lower_bound,temp_offset_upper_bound,lowest_heat_setpoint_ceiling,heat_setpoint_ceiling," +
    "highest_cool_setpoint_floor,cool_setpoint_floor";

  private refreshToken: string;
  private readonly deviceId?: string;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0; // epoch ms; 0 = unknown

  private socket: Socket | null = null;
  private listeners: Set<DeviceUpdateListener> = new Set();

  private commandQueue: QueuedCommand[] = [];
  private readonly commandQueueTtlMs = 30000;
  private manualReconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    refreshToken: string,
    private readonly log: Logging,
    deviceId?: string,
  ) {
    this.refreshToken = refreshToken;
    this.deviceId = deviceId;
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

      const url = this.deviceId
        ? `${this.oauthUrl}?device=${encodeURIComponent(this.deviceId)}`
        : this.oauthUrl;

      const resp = await axios.post(url, form.toString(), {
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

      if (
        typeof resp.data.expires_in === "number" &&
        resp.data.expires_in > 0
      ) {
        this.tokenExpiresAt = Date.now() + resp.data.expires_in * 1000;
      } else {
        this.tokenExpiresAt = 0;
      }

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
    if (this.tokenExpiresAt === 0) return true;
    return Date.now() < this.tokenExpiresAt - 60_000;
  }

  // ---------------------------------------------------------- connection ---

  async connect(): Promise<void> {
    if (!this.tokenIsFresh()) {
      await this.authenticate();
    }

    this.teardownSocket();

    // Using the official socket.io-client library instead of a hand-rolled
    // implementation over raw `ws`. This delegates engine.io/socket.io
    // protocol details (version negotiation, handshake sequencing, ping/pong,
    // reconnection backoff) to a maintained library that speaks the exact
    // same protocol family as python-socketio, which the reference
    // integration for this same endpoint uses successfully. Manually
    // replicating that protocol turned out to be an unreliable way to talk
    // to this server.
    const socket = io("https://rt.sensiapi.io", {
      path: "/thermostat/",
      transports: ["websocket"],
      extraHeaders: { Authorization: `bearer ${this.accessToken}` },
      query: { capabilities: this.capabilities },
      reconnection: true,
      reconnectionDelay: 5000,
      reconnectionDelayMax: 5 * 60 * 1000,
      randomizationFactor: 0.2,
      timeout: 15000,
    });

    this.socket = socket;

    socket.on("connect", () => {
      this.log.info("[Sensi] Connected (socket.io)");
      this.flushCommandQueue();
    });

    socket.on("disconnect", (reason) => {
      this.log.warn(`[Sensi] Disconnected: ${reason}`);
      // socket.io-client handles its own reconnection automatically for
      // most disconnect reasons. It does NOT auto-reconnect when the
      // server intentionally closes the namespace ("io server disconnect");
      // in that case we drive a manual reconnect ourselves.
      if (reason === "io server disconnect") {
        this.scheduleManualReconnect("server closed connection");
      }
    });

    socket.on("connect_error", async (err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error("[Sensi] Connection error:", message);

      if (
        message.toLowerCase().includes("jwt expired") ||
        message.toLowerCase().includes("expired")
      ) {
        this.log.warn(
          "[Sensi] Token appears expired — refreshing and retrying",
        );
        this.accessToken = null;
        try {
          await this.authenticate();
          this.teardownSocket();
          await this.connect();
        } catch (e) {
          this.log.error(
            "[Sensi] Re-auth after connect_error failed:",
            e instanceof Error ? e.message : String(e),
          );
        }
      }
      // For other connect errors, socket.io-client's built-in reconnection
      // logic will keep retrying with the configured backoff.
    });

    socket.onAny((event: string, ...args: any[]) => {
      if (event === "state" && Array.isArray(args[0])) {
        for (const device of args[0] as DeviceStatePacket[]) {
          for (const l of this.listeners) l(device);
        }
      }
    });
  }

  private teardownSocket(): void {
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      } catch (e) {
        this.log.debug("[Sensi] Error tearing down socket:", e);
      }
      this.socket = null;
    }
  }

  private scheduleManualReconnect(reason: string, delayMs = 10000): void {
    if (this.manualReconnectTimer) return;
    this.log.warn(
      `[Sensi] Scheduling manual reconnect in ${Math.round(delayMs / 1000)}s (${reason})`,
    );
    this.manualReconnectTimer = setTimeout(async () => {
      this.manualReconnectTimer = null;
      try {
        await this.connect();
      } catch (e) {
        this.log.error(
          "[Sensi] Manual reconnect failed:",
          e instanceof Error ? e.message : String(e),
        );
        this.scheduleManualReconnect("retry after failure", 30000);
      }
    }, delayMs);
  }

  // ------------------------------------------------------------- commands ---

  onDeviceUpdate(listener: DeviceUpdateListener): void {
    this.listeners.add(listener);
  }

  private sendSet(event: string, data: any): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit(event, data);
      this.log.debug("[Sensi] Command sent:", event, JSON.stringify(data));
      return;
    }

    this.commandQueue.push({ event, data, queuedAt: Date.now() });
    this.log.warn(
      "[Sensi] Connection not ready — queued command:",
      event,
      JSON.stringify(data),
    );
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
      this.socket?.emit(cmd.event, cmd.data);
      this.log.info(
        "[Sensi] Flushed queued command:",
        cmd.event,
        JSON.stringify(cmd.data),
      );
    }
  }

  setTemperature(
    icdId: string,
    temp: number,
    mode: string,
    scale: string,
  ): void {
    this.sendSet("set_temperature", {
      icd_id: icdId,
      target_temp: temp,
      mode,
      scale,
    });
  }

  setMode(icdId: string, value: string): void {
    this.sendSet("set_operating_mode", { icd_id: icdId, value });
  }

  setFanMode(icdId: string, value: string): void {
    this.sendSet("set_fan_mode", { icd_id: icdId, value });
  }

  setCirculatingFan(icdId: string, enabled: boolean, dutyCycle: number): void {
    this.sendSet("set_circulating_fan", {
      icd_id: icdId,
      value: { enabled: enabled ? "on" : "off", duty_cycle: dutyCycle },
    });
  }
}
