import { Logging, PlatformAccessory, Service, API } from 'homebridge';
import { SensiAPI, DeviceStatePacket } from './sensi-api';

export class SensiSensorAccessory {
  private tempService: Service;
  private humidityService: Service;

  constructor(
    private readonly log: Logging,
    private readonly accessory: PlatformAccessory,
    private readonly api: SensiAPI,
    private readonly hap: API['hap']
  ) {
    this.tempService = this.accessory.getService(this.hap.Service.TemperatureSensor)
      || this.accessory.addService(this.hap.Service.TemperatureSensor);

    this.humidityService = this.accessory.getService(this.hap.Service.HumiditySensor)
      || this.accessory.addService(this.hap.Service.HumiditySensor);

    this.api.onDeviceUpdate((dev: DeviceStatePacket) => {
      if (dev.icd_id.toLowerCase() === this.accessory.context.deviceId) {
        this.updateFromState(dev);
      }
    });
  }

  private updateFromState(dev: DeviceStatePacket): void {
    this.accessory.context.lastState = dev;
    const s = dev.state;
    if (!s) return;

    this.log.debug('Sensor accessory device state update', { id: dev.icd_id, state: s });

    const scale = s.display_scale ?? 'f';

    // Convert Fahrenheit to Celsius for HomeKit
    if (s.display_temp !== undefined && Number.isFinite(s.display_temp)) {
      const tempC = scale === 'f' ? (s.display_temp - 32) * 5 / 9 : s.display_temp;
      this.tempService.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, tempC);
    } else {
      this.log.debug('Skipping TemperatureSensor update: display_temp missing or invalid', s.display_temp);
    }

    if (s.humidity !== undefined && Number.isFinite(s.humidity)) {
      this.humidityService.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, s.humidity);
    } else {
      this.log.debug('Skipping HumiditySensor update: humidity missing or invalid', s.humidity);
    }
  }
}