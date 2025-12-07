"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SensiSensorAccessory = void 0;
class SensiSensorAccessory {
    constructor(log, accessory, api, hap) {
        this.log = log;
        this.accessory = accessory;
        this.api = api;
        this.hap = hap;
        this.tempService = this.accessory.getService(this.hap.Service.TemperatureSensor)
            || this.accessory.addService(this.hap.Service.TemperatureSensor);
        this.humidityService = this.accessory.getService(this.hap.Service.HumiditySensor)
            || this.accessory.addService(this.hap.Service.HumiditySensor);
        this.api.onDeviceUpdate((dev) => {
            if (dev.icd_id.toLowerCase() === this.accessory.context.deviceId) {
                this.updateFromState(dev);
            }
        });
    }
    updateFromState(dev) {
        this.accessory.context.lastState = dev;
        const s = dev.state;
        if (!s)
            return;
        const scale = s.display_scale ?? 'f';
        // Convert Fahrenheit to Celsius for HomeKit
        if (s.display_temp !== undefined) {
            const tempC = scale === 'f' ? (s.display_temp - 32) * 5 / 9 : s.display_temp;
            this.tempService.updateCharacteristic(this.hap.Characteristic.CurrentTemperature, tempC);
        }
        if (s.humidity !== undefined) {
            this.humidityService.updateCharacteristic(this.hap.Characteristic.CurrentRelativeHumidity, s.humidity);
        }
    }
}
exports.SensiSensorAccessory = SensiSensorAccessory;
//# sourceMappingURL=sensi-sensor-accessory.js.map