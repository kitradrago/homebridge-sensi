import { Logging } from 'homebridge';
export interface DeviceStatePacket {
    icd_id: string;
    registration?: {
        name?: string;
        product_type?: string;
    };
    state?: any;
    capabilities?: Record<string, any>;
}
export type DeviceUpdateListener = (device: DeviceStatePacket) => void;
export declare class SensiAPI {
    private readonly log;
    private readonly oauthUrl;
    private readonly wsUrl;
    private refreshToken;
    private accessToken;
    private ws;
    private listeners;
    private reconnecting;
    private pingInterval;
    constructor(refreshToken: string, log: Logging);
    authenticate(): Promise<void>;
    private wsHeaders;
    connect(): Promise<void>;
    private handleMessage;
    private reconnectWithNewToken;
    private scheduleReconnect;
    private startKeepAlive;
    private stopKeepAlive;
    onDeviceUpdate(listener: DeviceUpdateListener): void;
    private sendSet;
    setTemperature(icdId: string, temp: number, mode: string, scale: string): void;
    setMode(icdId: string, value: string): void;
    setFanMode(icdId: string, value: string): void;
    setCirculatingFan(icdId: string, enabled: boolean, dutyCycle: number): void;
}
