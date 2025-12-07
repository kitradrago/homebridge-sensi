import axios from 'axios';
import WebSocket from 'ws';
import { Logging } from 'homebridge';

export interface DeviceStatePacket {
  icd_id: string;
  registration?: { name?: string; product_type?: string };
  state?: any;
  capabilities?: Record<string, any>;
}

export type DeviceUpdateListener = (device: DeviceStatePacket) => void;

export class SensiAPI {
  private readonly oauthUrl = 'https://oauth.sensiapi.io/token';
  private readonly wsUrl = 'wss://rt.sensiapi.io/thermostat/?transport=websocket';

  private refreshToken: string;
  private accessToken: string | null = null;
  private ws: WebSocket | null = null;
  private listeners: Set<DeviceUpdateListener> = new Set();
  private reconnecting = false;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(refreshToken: string, private readonly log: Logging) {
    this.refreshToken = refreshToken;
  }

  async authenticate(): Promise<void> {
    const form = new URLSearchParams();
    form.set('client_id', 'fleet');
    form.set('client_secret', 'JLFjJmketRhj>M9uoDhusYKyi?zUyNqhGB)H2XiwLEF#KcGKrRD2JZsDQ7ufNven');
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', this.refreshToken);

    const resp = await axios.post(this.oauthUrl, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', Accept: '*/*' },
      timeout: 10000,
    });

    this.accessToken = resp.data.access_token;
    this.refreshToken = resp.data.refresh_token;
    this.log.info('[Sensi] OAuth success: access token acquired');
  }

  private wsHeaders(): Record<string, string> {
    return { Authorization: `bearer ${this.accessToken}` };
  }

  async connect(): Promise<void> {
    if (!this.accessToken) await this.authenticate();

    this.ws = new WebSocket(this.wsUrl, { headers: this.wsHeaders() });
    this.ws.on('open', () => {
      this.log.info('[Sensi] WebSocket connected');
      this.startKeepAlive();
    });
    this.ws.on('message', (data) => this.handleMessage(data));
    this.ws.on('close', () => this.scheduleReconnect('closed'));
    this.ws.on('error', (err) => {
      this.log.error('[Sensi] WebSocket error', err);
      this.scheduleReconnect('error');
    });
  }

  private async handleMessage(raw: WebSocket.Data): Promise<void> {
    const msg = typeof raw === 'string' ? raw : raw.toString('utf-8');

    if (msg.startsWith('44')) {
      this.log.warn('[Sensi] Token expired. Refreshing...');
      await this.reconnectWithNewToken();
      return;
    }

    if (!msg.startsWith('42')) return;

    try {
      const payload = JSON.parse(msg.slice(2));
      const event = payload[0];
      const data = payload[1];

      if (event === 'state' && Array.isArray(data)) {
        for (const device of data as DeviceStatePacket[]) {
          for (const l of this.listeners) l(device);
        }
      }
    } catch (e) {
      this.log.error('[Sensi] Failed to parse WS message', e);
    }
  }

  private async reconnectWithNewToken(): Promise<void> {
    try {
      await this.authenticate();
      await this.connect();
    } catch (e) {
      this.log.error('[Sensi] Reconnect failed', e);
      this.scheduleReconnect('auth failed');
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
        this.log.error('[Sensi] Retry reconnect failed', e);
      }
    }, 10000); // 10s backoff
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        this.log.debug('[Sensi] Sent keep-alive ping');
      }
    }, 30000); // every 30s
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

  // Send commands
  private sendSet(json: any): void {
    const frame = '421' + JSON.stringify(json);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(frame);
    } else {
      this.log.warn('[Sensi] WS not open. Dropping command.');
    }
  }

  setTemperature(icdId: string, temp: number, mode: string, scale: string): void {
    this.sendSet(['set_temperature', { icd_id: icdId, target_temp: temp, mode, scale }]);
  }

  setMode(icdId: string, value: string): void {
    this.sendSet(['set_operating_mode', { icd_id: icdId, value }]);
  }

  setFanMode(icdId: string, value: string): void {
    this.sendSet(['set_fan_mode', { icd_id: icdId, value }]);
  }

  setCirculatingFan(icdId: string, enabled: boolean, dutyCycle: number): void {
    this.sendSet(['set_circulating_fan', { icd_id: icdId, value: { enabled: enabled ? 'on' : 'off', duty_cycle: dutyCycle } }]);
  }
}
