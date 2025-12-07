import { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';
export declare class SensiPlatform implements DynamicPlatformPlugin {
    private readonly log;
    private readonly api;
    private readonly config;
    private readonly accessories;
    private sensiApi;
    constructor(log: Logging, config: PlatformConfig, api: API);
    initialize(): Promise<void>;
    configureAccessory(accessory: PlatformAccessory): void;
}
