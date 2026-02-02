import {
  Logging,
  PlatformAccessory,
  Service,
  API,
  CharacteristicValue, // <-- added
} from 'homebridge';
import { SensiAPI } from './sensi-api';

export class SensiThermostatAccessory {
  private service: Service;

  constructor(
    private readonly log: Logging,
    private readonly accessory: PlatformAccessory,
    private readonly api: SensiAPI,
    private readonly hap: API['hap']
  ) {
    this.service =
      this.accessory.getService(this.hap.Service.Thermostat) ||
      this.accessory.addService(this.hap.Service.Thermostat);

    /* Listen for updates from the Sensi API */
    this.api.onDeviceUpdate((dev) => {
      if (dev.icd_id.toLowerCase() === this.accessory.context.deviceId) {
        this.updateFromState(dev);
      }
    });

    /* Target temperature set from HomeKit */
    this.service
      .getCharacteristic(this.hap.Characteristic.TargetTemperature)
      .onSet(async (value: CharacteristicValue) => {
        const tempC = Number(value); // HomeKit supplies Celsius
        if (!Number.isFinite(tempC)) {
          this.log.warn('Invalid TargetTemperature from HomeKit:', value);
          return;
        }

        const devId = this.accessory.context.deviceId;
        const state = this.accessory.context.lastState;
        const scale = state?.state?.display_scale ?? 'f';
        const mode = state?.state?.operating_mode ?? 'auto';

        // Convert to Fahrenheit only if the device expects it.
        // Round because the Sensi API requires integer Fahrenheit values.
        let tempToSend: number;
        if (scale === 'f') {
          tempToSend = Math.round(tempC * 9 / 5 + 32);
        } else {
          tempToSend = tempC;
        }

        this.log.debug('Setting temperature', {
          devId,
          tempToSend,
          mode,
          scale,
        });
        this.api.setTemperature(devId, tempToSend, mode, scale);
      });

    /* Heating/cooling mode set from HomeKit */
    this.service
      .getCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState)
      .onSet(async (value: CharacteristicValue) => {
        const devId = this.accessory.context.deviceId;
        const mode = this.mapHapMode(Number(value));
        this.api.setMode(devId, mode);
      });
  }

  /** Update HomeKit characteristics from a device state packet */
  private updateFromState(dev: any): void {
    this.accessory.context.lastState = dev;
    const s = dev.state;
    if (!s) return;

    this.log.debug('Device state update', { id: dev.icd_id, state: s });

    const scale = s.display_scale ?? 'f';

    // Current temperature
    if (s.display_temp !== undefined && Number.isFinite(s.display_temp)) {
      const currentTempC =
        scale === 'f' ? (s.display_temp - 32) * 5 / 9 : s.display_temp;
      this.service.updateCharacteristic(
        this.hap.Characteristic.CurrentTemperature,
        currentTempC
      );
    }

    // Target temperature (heat or cool)
    const targetTempF = s.current_heat_temp ?? s.current_cool_temp;
    if (targetTempF !== undefined && Number.isFinite(targetTempF)) {
      const targetTempC =
        scale === 'f' ? (targetTempF - 32) * 5 / 9 : targetTempF;
      this.service.updateCharacteristic(
        this.hap.Characteristic.TargetTemperature,
        targetTempC
      );
    }

    // HVAC mode
    const hvacMode = s.operating_mode;
    this.service.updateCharacteristic(
      this.hap.Characteristic.CurrentHeatingCoolingState,
      this.mapApiModeCurrent(hvacMode)
    );
    this.service.updateCharacteristic(
      this.hap.Characteristic.TargetHeatingCoolingState,
      this.mapApiModeTarget(hvacMode)
    );
  }

  /** Map API mode string to HomeKit CurrentHeatingCoolingState */
  private mapApiModeCurrent(mode: string): number {
    switch (mode) {
      case 'heat':
        return this.hap.Characteristic.CurrentHeatingCoolingState.HEAT;
      case 'cool':
        return this.hap.Characteristic.CurrentHeatingCoolingState.COOL;
      case 'off':
      default:
        return this.hap.Characteristic.CurrentHeatingCoolingState.OFF;
    }
  }

  /** Map API mode string to HomeKit TargetHeatingCoolingState */
  private mapApiModeTarget(mode: string): number {
    switch (mode) {
      case 'heat':
        return this.hap.Characteristic.TargetHeatingCoolingState.HEAT;
      case 'cool':
        return this.hap.Characteristic.TargetHeatingCoolingState.COOL;
      case 'auto':
        return this.hap.Characteristic.TargetHeatingCoolingState.AUTO;
      case 'off':
      default:
        return this.hap.Characteristic.TargetHeatingCoolingState.OFF;
    }
  }

  /** Convert HomeKit TargetHeatingCoolingState number to API mode string */
  private mapHapMode(value: number): string {
    switch (value) {
      case this.hap.Characteristic.TargetHeatingCoolingState.HEAT:
        return 'heat';
      case this.hap.Characteristic.TargetHeatingCoolingState.COOL:
        return 'cool';
      case this.hap.Characteristic.TargetHeatingCoolingState.AUTO:
        return 'auto';
      case this.hap.Characteristic.TargetHeatingCoolingState.OFF:
      default:
        return 'off';
    }
  }
}
