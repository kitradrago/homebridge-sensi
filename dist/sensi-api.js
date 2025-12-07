"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SensiAPI = void 0;
const axios_1 = __importDefault(require("axios"));
const ws_1 = __importDefault(require("ws"));
class SensiAPI {
    constructor(refreshToken, log) {
        this.log = log;
        this.oauthUrl = 'https://oauth.sensiapi.io/token';
        this.wsUrl = 'wss://rt.sensiapi.io/thermostat/?transport=websocket';
        this.accessToken = null;
        this.ws = null;
        this.listeners = new Set();
        this.reconnecting = false;
        this.pingInterval = null;
        this.refreshToken = refreshToken;
    }
    async authenticate() {
        const form = new URLSearchParams();
        form.set('client_id', 'fleet');
        form.set('client_secret', 'JLFjJmketRhj>M9uoDhusYKyi?zUyNqhGB)H2XiwLEF#KcGKrRD2JZsDQ7ufNven');
        form.set('grant_type', 'refresh_token');
        form.set('refresh_token', this.refreshToken);
        const resp = await axios_1.default.post(this.oauthUrl, form.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8', Accept: '*/*' },
            timeout: 10000,
        });
        this.accessToken = resp.data.access_token;
        this.refreshToken = resp.data.refresh_token;
        this.log.info('[Sensi] OAuth success: access token acquired');
    }
    wsHeaders() {
        return { Authorization: `bearer ${this.accessToken}` };
    }
    async connect() {
        if (!this.accessToken)
            await this.authenticate();
        this.ws = new ws_1.default(this.wsUrl, { headers: this.wsHeaders() });
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
    async handleMessage(raw) {
        const msg = typeof raw === 'string' ? raw : raw.toString('utf-8');
        if (msg.startsWith('44')) {
            this.log.warn('[Sensi] Token expired. Refreshing...');
            await this.reconnectWithNewToken();
            return;
        }
        if (!msg.startsWith('42'))
            return;
        try {
            const payload = JSON.parse(msg.slice(2));
            const event = payload[0];
            const data = payload[1];
            if (event === 'state' && Array.isArray(data)) {
                for (const device of data) {
                    for (const l of this.listeners)
                        l(device);
                }
            }
        }
        catch (e) {
            this.log.error('[Sensi] Failed to parse WS message', e);
        }
    }
    async reconnectWithNewToken() {
        try {
            await this.authenticate();
            await this.connect();
        }
        catch (e) {
            this.log.error('[Sensi] Reconnect failed', e);
            this.scheduleReconnect('auth failed');
        }
    }
    scheduleReconnect(reason) {
        if (this.reconnecting)
            return;
        this.reconnecting = true;
        this.stopKeepAlive();
        this.log.warn(`[Sensi] Scheduling reconnect due to ${reason}`);
        setTimeout(async () => {
            this.reconnecting = false;
            try {
                await this.reconnectWithNewToken();
            }
            catch (e) {
                this.log.error('[Sensi] Retry reconnect failed', e);
            }
        }, 10000); // 10s backoff
    }
    startKeepAlive() {
        this.stopKeepAlive();
        this.pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
                this.ws.ping();
                this.log.debug('[Sensi] Sent keep-alive ping');
            }
        }, 30000); // every 30s
    }
    stopKeepAlive() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
    onDeviceUpdate(listener) {
        this.listeners.add(listener);
    }
    // Send commands
    sendSet(json) {
        const frame = '421' + JSON.stringify(json);
        if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
            this.ws.send(frame);
        }
        else {
            this.log.warn('[Sensi] WS not open. Dropping command.');
        }
    }
    setTemperature(icdId, temp, mode, scale) {
        this.sendSet(['set_temperature', { icd_id: icdId, target_temp: temp, mode, scale }]);
    }
    setMode(icdId, value) {
        this.sendSet(['set_operating_mode', { icd_id: icdId, value }]);
    }
    setFanMode(icdId, value) {
        this.sendSet(['set_fan_mode', { icd_id: icdId, value }]);
    }
    setCirculatingFan(icdId, enabled, dutyCycle) {
        this.sendSet(['set_circulating_fan', { icd_id: icdId, value: { enabled: enabled ? 'on' : 'off', duty_cycle: dutyCycle } }]);
    }
}
exports.SensiAPI = SensiAPI;
//# sourceMappingURL=sensi-api.js.map