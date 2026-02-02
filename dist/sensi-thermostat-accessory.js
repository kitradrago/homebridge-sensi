"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SensiThermostatAccessory = void 0;
class SensiThermostatAccessory {
    constructor(log, accessory, api, hap) {
        this.log = log;
        this.accessory = accessory;
        this.api = api;
        this.hap = hap;
        this.service = this.accessory.getService(this.hap.Service.Thermostat)
            || this.accessory.addService(this.hap.Service.Thermostat);
        this.api.onDeviceUpdate((dev) => {
            if (dev.icd_id.toLowerCase() === this.accessory.context.deviceId) {
                this.updateFromState(dev);
            }
        });
        this.service.getCharacteristic(this.hap.Characteristic.TargetTemperature)
            .onSet(async (value) => {
            const tempC = Number(value); // HomeKit gives Celsius
            if (!Number.isFinite(tempC)) {
                this.log.warn('Received invalid TargetTemperature from HomeKit:', value);
                return;
            }
            const devId = this.accessory.context.deviceId;
            const state = this.accessory.context.lastState;
            const scale = state?.state?.display_scale ?? 'f';
            const mode = state?.state?.operating_mode ?? 'auto';
            // Convert back to Fahrenheit only if the device uses 'f'.
            // Historically the device API expects integer Fahrenheit degrees; keep the rounding
            // for Fahrenheit devices, but do not round Celsius devices.
            let tempToSend;
            if (scale === 'f') {
                tempToSend = Math.round(tempC * 9 / 5 + 32);
            }
            else {
                tempToSend = tempC;
            }
            this.log.debug('Setting temperature', { devId, tempToSend, mode, scale });
            this.api.setTemperature(devId, tempToSend, mode, scale);
        });
        this.service.getCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState)
            .onSet(async (value) => {
            const devId = this.accessory.context.deviceId;
            const mode = this.mapHapMode(value);
            this.api.setMode(devId, mode);
        });
    }
    updateFromState(dev) {
        this.accessory.context.lastState = dev;
        const s = dev.state;
        if (!s)
            return;
        // debug-log the incoming state at debug level to help triage missing fields
        this.log.debug('Device state update', { id: dev.icd_id, state: s });
        const scale = s.display_scale ?? 'f';
        // Guard current temperature
        if (s.display_temp !== undefined && Number.isFinite(s.display_temp)) {
            const currentTempC = scale === 'f' ? (s.display_temp - 32) * 5 / 9 : s.display_temp;
            this.service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, currentTempC);
        }
        else {
            this.log.debug('Skipping CurrentTemperature update: display_temp missing or invalid', s.display_temp);
        }
        // Guard target temperature (heat OR cool)
        const targetTempF = s.current_heat_temp ?? s.current_cool_temp;
        if (targetTempF !== undefined && Number.isFinite(targetTempF)) {
            const targetTempC = scale === 'f' ? (targetTempF - 32) * 5 / 9 : targetTempF;
            this.service.updateCharacteristic(this.hap.Characteristic.TargetTemperature, targetTempC);
        }
        else {
            this.log.debug('Skipping TargetTemperature update: no target temperature in state', {
                current_heat_temp: s.current_heat_temp,
                current_cool_temp: s.current_cool_temp
            });
        }
        const hvacMode = s.operating_mode;
        this.service.updateCharacteristic(this.hap.Characteristic.CurrentHeatingCoolingState, this.mapApiModeCurrent(hvacMode));
        this.service.updateCharacteristic(this.hap.Characteristic.TargetHeatingCoolingState, this.mapApiModeTarget(hvacMode));
    }
    mapApiModeCurrent(mode) {
        switch (mode) {
            case 'heat': return this.hap.Characteristic.CurrentHeatingCoolingState.HEAT;
            case 'cool': return this.hap.Characteristic.CurrentHeatingCoolingState.COOL;
            case 'off':
            default: return this.hap.Characteristic.CurrentHeatingCoolingState.OFF;
        }
    }
    mapApiModeTarget(mode) {
        switch (mode) {
            case 'heat': return this.hap.Characteristic.TargetHeatingCoolingState.HEAT;
            case 'cool': return this.hap.Characteristic.TargetHeatingCoolingState.COOL;
            case 'auto': return this.hap.Characteristic.TargetHeatingCoolingState.AUTO;
            case 'off':
            default: return this.hap.Characteristic.TargetHeatingCoolingState.OFF;
        }
    }
    // Map HomeKit TargetHeatingCoolingState numbers to API mode strings
    mapHapMode(value) {
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
exports.SensiThermostatAccessory = SensiThermostatAccessory;
//# sourceMappingURL=sensi-thermostat-accessory.js.map