import {
  Logging,
  PlatformAccessory,
  Service,
  API,
  CharacteristicValue,
} from 'homebridge';
import { SensiAPI, DeviceStatePacket } from './sensi-api';

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
    this.api.onDeviceUpdate((dev: DeviceStatePacket) => {
      if (dev.icd_id.toLowerCase() === this.accessory.context.deviceId) {
        this.updateFromState(dev);
      }
    });

    /* Target temperature set from HomeKit (used in Heat or Cool mode) */
    this.service
      .getCharacteristic(this.hap.Characteristic.TargetTemperature)
      .onSet(async (value: CharacteristicValue) => {
        try {
          const tempC = Number(value);
          if (!Number.isFinite(tempC)) {
            this.log.warn('[Sensi] Invalid TargetTemperature from HomeKit:', value);
            return;
          }

          const devId = this.accessory.context.deviceId;
          const state = this.accessory.context.lastState;
          const scale = state?.state?.display_scale ?? 'f';
          const mode = state?.state?.operating_mode ?? 'heat';

          let tempToSend: number;
          if (scale === 'f') {
            tempToSend = Math.round(tempC * 9 / 5 + 32);
          } else {
            tempToSend = tempC;
          }

          this.log.info('[Sensi] Setting temperature', {
            deviceId: devId,
            tempToSend,
            mode,
            scale,
          });
          this.api.setTemperature(devId, tempToSend, mode, scale);
        } catch (error) {
          this.log.error('[Sensi] Error setting temperature:', error instanceof Error ? error.message : String(error));
        }
      });

    /* Heating threshold — lower bound in Auto mode */
    this.service
      .getCharacteristic(this.hap.Characteristic.HeatingThresholdTemperature)
      .onSet(async (value: CharacteristicValue) => {
        try {
          const tempC = Number(value);
          if (!Number.isFinite(tempC)) {
            this.log.warn('[Sensi] Invalid HeatingThresholdTemperature from HomeKit:', value);
            return;
          }

          const devId = this.accessory.context.deviceId;
          const state = this.accessory.context.lastState;
          const scale = state?.state?.display_scale ?? 'f';

          let tempToSend: number;
          if (scale === 'f') {
            tempToSend = Math.round(tempC * 9 / 5 + 32);
          } else {
            tempToSend = tempC;
          }

          this.log.info('[Sensi] Setting heating threshold (auto mode)', {
            deviceId: devId,
            tempToSend,
            scale,
          });
          // Send as 'heat' leg of the auto setpoint
          this.api.setTemperature(devId, tempToSend, 'heat', scale);
        } catch (error) {
          this.log.error('[Sensi] Error setting heating threshold:', error instanceof Error ? error.message : String(error));
        }
      });

    /* Cooling threshold — upper bound in Auto mode */
    this.service
      .getCharacteristic(this.hap.Characteristic.CoolingThresholdTemperature)
      .onSet(async (value: CharacteristicValue) => {
        try {
          const tempC = Number(value);
          if (!Number.isFinite(tempC)) {
            this.log.warn('[Sensi] Invalid CoolingThresholdTemperature from HomeKit:', value);
            return;
          }

          const devId = this.accessory.context.deviceId;
          const state = this.accessory.context.lastState;
          const scale = state?.state?.display_scale ?? 'f';

          let tempToSend: number;
          if (scale === 'f') {
            tempToSend = Math.round(tempC * 9 / 5 + 32);
          } else {
            tempToSend = tempC;
          }

          this.log.info('[Sensi] Setting cooling threshold (auto mode)', {
            deviceId: devId,
            tempToSend,
            scale,
          });
          // Send as 'cool' leg of the auto setpoint
          this.api.setTemperature(devId, tempToSend, 'cool', scale);
        } catch (error) {
          this.log.error('[Sensi] Error setting cooling threshold:', error instanceof Error ? error.message : String(error));
        }
      });

    /* Heating/cooling mode set from HomeKit */
    this.service
      .getCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState)
      .onSet(async (value: CharacteristicValue) => {
        try {
          const devId = this.accessory.context.deviceId;
          const mode = this.mapHapMode(Number(value));
          this.log.info('[Sensi] Setting operating mode:', { deviceId: devId, mode });
          this.api.setMode(devId, mode);
        } catch (error) {
          this.log.error('[Sensi] Error setting mode:', error instanceof Error ? error.message : String(error));
        }
      });
  }

  /** Update HomeKit characteristics from a device state packet */
  private updateFromState(dev: DeviceStatePacket): void {
    try {
      // The realtime socket sends a full snapshot on initial sync but only a
      // partial delta (just the changed fields) for live pushes triggered by
      // the physical device. Merge onto the last known state instead of
      // overwriting, otherwise a delta missing e.g. `operating_mode` silently
      // breaks the branch below and the update gets dropped.
      const previous = this.accessory.context.lastState?.state ?? {};
      const mergedState = { ...previous, ...(dev.state ?? {}) };
      const merged: DeviceStatePacket = { ...dev, state: mergedState };
      this.accessory.context.lastState = merged;
      const s = mergedState;
      if (!s) return;

      this.log.debug('[Sensi] Device state update', { id: dev.icd_id, state: s });

      const scale = s.display_scale ?? 'f';

      // Current temperature
      if (s.display_temp !== undefined && Number.isFinite(s.display_temp)) {
        const currentTempC =
          scale === 'f' ? (s.display_temp - 32) * 5 / 9 : s.display_temp;
        this.service.updateCharacteristic(
          this.hap.Characteristic.CurrentTemperature,
          currentTempC
        );
      } else {
        this.log.debug('[Sensi] Skipping current temperature update: missing or invalid', s.display_temp);
      }

      // HVAC mode — determine first so we know how to handle temps below
      const hvacMode = s.operating_mode;
      this.service.updateCharacteristic(
        this.hap.Characteristic.CurrentHeatingCoolingState,
        this.mapApiModeCurrent(hvacMode)
      );
      this.service.updateCharacteristic(
        this.hap.Characteristic.TargetHeatingCoolingState,
        this.mapApiModeTarget(hvacMode)
      );

      if (hvacMode === 'auto') {
        // AUTO MODE — set both threshold temperatures independently
        if (s.current_heat_temp !== undefined && Number.isFinite(s.current_heat_temp)) {
          const heatThresholdC =
            scale === 'f' ? (s.current_heat_temp - 32) * 5 / 9 : s.current_heat_temp;
          this.service.updateCharacteristic(
            this.hap.Characteristic.HeatingThresholdTemperature,
            heatThresholdC
          );
          // Keep TargetTemperature in sync with the heating setpoint as a fallback
          this.service.updateCharacteristic(
            this.hap.Characteristic.TargetTemperature,
            heatThresholdC
          );
        } else {
          this.log.debug('[Sensi] Skipping heating threshold update: missing or invalid', s.current_heat_temp);
        }

        if (s.current_cool_temp !== undefined && Number.isFinite(s.current_cool_temp)) {
          const coolThresholdC =
            scale === 'f' ? (s.current_cool_temp - 32) * 5 / 9 : s.current_cool_temp;
          this.service.updateCharacteristic(
            this.hap.Characteristic.CoolingThresholdTemperature,
            coolThresholdC
          );
        } else {
          this.log.debug('[Sensi] Skipping cooling threshold update: missing or invalid', s.current_cool_temp);
        }
      } else {
        // HEAT or COOL mode — single target temperature
        const targetTempF =
          hvacMode === 'heat' ? s.current_heat_temp : s.current_cool_temp;

        if (targetTempF !== undefined && Number.isFinite(targetTempF)) {
          const targetTempC =
            scale === 'f' ? (targetTempF - 32) * 5 / 9 : targetTempF;
          this.service.updateCharacteristic(
            this.hap.Characteristic.TargetTemperature,
            targetTempC
          );
          // Mirror into thresholds too so they stay consistent
          if (hvacMode === 'heat') {
            this.service.updateCharacteristic(
              this.hap.Characteristic.HeatingThresholdTemperature,
              targetTempC
            );
          } else {
            this.service.updateCharacteristic(
              this.hap.Characteristic.CoolingThresholdTemperature,
              targetTempC
            );
          }
        } else {
          this.log.debug('[Sensi] Skipping target temperature update: missing or invalid', targetTempF);
        }
      }
    } catch (error) {
      this.log.error('[Sensi] Error updating thermostat state:', error instanceof Error ? error.message : String(error));
    }
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
