**index.js**

```js
let Service, Characteristic;
const SensiAPI = require('./sensi-api');

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  api.registerAccessory('HomebridgeSensi', HomebridgeSensi);
};

class HomebridgeSensi {
  constructor(log, config, api) {
    this.log = log;
    this.name = config.name || 'Sensi Thermostat';
    this.refreshToken = config.refreshToken;
    this.deviceId = config.deviceId;

    this.apiClient = new SensiAPI(this.refreshToken, this.deviceId, this.log);

    this.service = new Service.Thermostat(this.name);

    this.service.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.service.getCharacteristic(Characteristic.TargetTemperature)
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    this.service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getHeatingCoolingState.bind(this));

    this.service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .onGet(this.getHeatingCoolingState.bind(this))
      .onSet(this.setHeatingCoolingState.bind(this));

    setInterval(() => this.updateState(), 30000);
  }

  async updateState() {
    try {
      const data = await this.apiClient.getStatus();
      this.service.updateCharacteristic(Characteristic.CurrentTemperature, data.currentTemperature);
      this.service.updateCharacteristic(Characteristic.TargetTemperature, data.targetTemperature);
      this.service.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, data.mode);
      this.log('State updated');
    } catch (err) {
      this.log.error('Failed to update state:', err);
    }
  }

  async getCurrentTemperature() {
    const data = await this.apiClient.getStatus();
    return data.currentTemperature;
  }

  async getTargetTemperature() {
    const data = await this.apiClient.getStatus();
    return data.targetTemperature;
  }

  async setTargetTemperature(value) {
    await this.apiClient.setTemperature(value);
  }

  async getHeatingCoolingState() {
    const data = await this.apiClient.getStatus();
    return data.mode;
  }

  async setHeatingCoolingState(value) {
    await this.apiClient.setMode(value);
  }

  getServices() {
    return [this.service];
  }
}
```
