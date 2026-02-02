import { Logging, PlatformAccessory, API } from 'homebridge';
import { SensiAPI } from './sensi-api';
export declare class SensiSensorAccessory {
    private readonly log;
    private readonly accessory;
    private readonly api;
    private readonly hap;
    private tempService;
    private humidityService;
    constructor(log: Logging, accessory: PlatformAccessory, api: SensiAPI, hap: API['hap']);
    private updateFromState;
}
