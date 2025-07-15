let Service, Characteristic;

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  api.registerAccessory('HomebridgeSensi', HomebridgeSensi);
};

class HomebridgeSensi {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.name = config.name || 'Sensi Thermostat';

    this.service = new Service.Thermostat(this.name);
    this.service.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.handleCurrentTemperatureGet.bind(this));

    // Add more characteristic handlers here...
  }

  async handleCurrentTemperatureGet() {
    this.log('Getting current temperature...');
    // TODO: call Sensi API to get temperature
    return 22.0; // example fixed value
  }

  getServices() {
    return [this.service];
  }
}
