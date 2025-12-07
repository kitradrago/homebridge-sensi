import { Logging, PlatformAccessory, API } from 'homebridge';
import { SensiAPI } from './sensi-api';
export declare class SensiThermostatAccessory {
    private readonly log;
    private readonly accessory;
    private readonly api;
    private readonly hap;
    private service;
    constructor(log: Logging, accessory: PlatformAccessory, api: SensiAPI, hap: API['hap']);
    private updateFromState;
    private mapApiModeCurrent;
    private mapApiModeTarget;
    private mapHapMode;
}
