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
            const devId = this.accessory.context.deviceId;
            const state = this.accessory.context.lastState;
            const scale = state?.state?.display_scale ?? 'f';
            const mode = state?.state?.operating_mode ?? 'auto';
            // Convert back to Fahrenheit if device uses 'f'
            const tempF = scale === 'f' ? Math.round(tempC * 9 / 5 + 32) : tempC;
            this.api.setTemperature(devId, tempF, mode, scale);
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
        const scale = s.display_scale ?? 'f';
        // Convert Fahrenheit to Celsius for HomeKit
        const currentTempC = scale === 'f' ? (s.display_temp - 32) * 5 / 9 : s.display_temp;
        const targetTempF = s.current_heat_temp ?? s.current_cool_temp;
        const targetTempC = scale === 'f' ? (targetTempF - 32) * 5 / 9 : targetTempF;
        const hvacMode = s.operating_mode;
        this.service.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, currentTempC);
        this.service.updateCharacteristic(this.hap.Characteristic.TargetTemperature, targetTempC);
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
    mapHapMode(value) {
        const C = this.hap.Characteristic.TargetHeatingCoolingState;
        if (value === C.HEAT)
            return 'heat';
        if (value === C.COOL)
            return 'cool';
        if (value === C.AUTO)
            return 'auto';
        return 'off';
    }
}
exports.SensiThermostatAccessory = SensiThermostatAccessory;
//# sourceMappingURL=sensi-thermostat-accessory.js.map