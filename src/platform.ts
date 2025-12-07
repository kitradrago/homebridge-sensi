import {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';

import { SensiAPI, DeviceStatePacket } from './sensi-api';
import { SensiThermostatAccessory } from './sensi-thermostat-accessory';
import { SensiSensorAccessory } from './sensi-sensor-accessory';

export class SensiPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly api: API;
  private readonly config: PlatformConfig;
  private readonly accessories: PlatformAccessory[] = [];
  private sensiApi!: SensiAPI;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;
    this.config = config;

    this.api.on('didFinishLaunching', () => {
      this.initialize().catch((e) => this.log.error('[Sensi] Init error:', e));
    });
  }

  async initialize(): Promise<void> {
    if (!this.config.refreshToken) {
      this.log.warn('[Sensi] Refresh token missing – cannot connect.');
      return;
    }

    this.sensiApi = new SensiAPI(this.config.refreshToken as string, this.log);
    await this.sensiApi.authenticate();
    await this.sensiApi.connect();

    const seen = new Set<string>();
    this.sensiApi.onDeviceUpdate((dev: DeviceStatePacket) => {
      const id = dev.icd_id.toLowerCase();
      if (seen.has(id)) {
        return;
      }
      seen.add(id);

      const name = dev.registration?.name ?? 'Sensi Thermostat';
      const uuid = this.api.hap.uuid.generate(id);
      const accessory = new this.api.platformAccessory(name, uuid);
      accessory.context.deviceId = id;

      // Register thermostat accessory
      new SensiThermostatAccessory(this.log, accessory, this.sensiApi, this.api.hap);
      this.api.registerPlatformAccessories('homebridge-sensi', 'SensiPlatform', [accessory]);
      this.accessories.push(accessory);

      // Register sensor accessory
      new SensiSensorAccessory(this.log, accessory, this.sensiApi, this.api.hap);
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }
}
