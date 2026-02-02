"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SensiPlatform = void 0;
const sensi_api_1 = require("./sensi-api");
const sensi_thermostat_accessory_1 = require("./sensi-thermostat-accessory");
const sensi_sensor_accessory_1 = require("./sensi-sensor-accessory");
class SensiPlatform {
    constructor(log, config, api) {
        this.accessories = [];
        this.log = log;
        this.api = api;
        this.config = config;
        this.api.on('didFinishLaunching', () => {
            this.initialize().catch((e) => this.log.error('[Sensi] Init error:', e));
        });
    }
    async initialize() {
        if (!this.config.refreshToken) {
            this.log.warn('[Sensi] Refresh token missing – cannot connect.');
            return;
        }
        this.sensiApi = new sensi_api_1.SensiAPI(this.config.refreshToken, this.log);
        await this.sensiApi.authenticate();
        await this.sensiApi.connect();
        const seen = new Set();
        this.sensiApi.onDeviceUpdate((dev) => {
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
            new sensi_thermostat_accessory_1.SensiThermostatAccessory(this.log, accessory, this.sensiApi, this.api.hap);
            this.api.registerPlatformAccessories('homebridge-sensi', 'SensiPlatform', [accessory]);
            this.accessories.push(accessory);
            // Register sensor accessory
            new sensi_sensor_accessory_1.SensiSensorAccessory(this.log, accessory, this.sensiApi, this.api.hap);
        });
    }
    configureAccessory(accessory) {
        this.accessories.push(accessory);
    }
}
exports.SensiPlatform = SensiPlatform;
//# sourceMappingURL=platform.js.map