**sensi-api.js**

```js
const axios = require('axios');

class SensiAPI {
  constructor(refreshToken, deviceId, log) {
    this.refreshToken = refreshToken;
    this.deviceId = deviceId;
    this.log = log;
    this.baseUrl = 'https://api.sensi.emerson.com/v1';
    this.authHeader = { 'Authorization': `Bearer ${this.refreshToken}` };
  }

  async getStatus() {
    const res = await axios.get(`${this.baseUrl}/devices/${this.deviceId}/status`, { headers: this.authHeader });
    const data = res.data;
    return {
      currentTemperature: data.indoorTemperature,
      targetTemperature: data.setPoint,
      mode: this.mapMode(data.systemMode)
    };
  }

  async setTemperature(temp) {
    await axios.put(`${this.baseUrl}/devices/${this.deviceId}/temperature`, { temperature: temp }, { headers: this.authHeader });
  }

  async setMode(mode) {
    await axios.put(`${this.baseUrl}/devices/${this.deviceId}/mode`, { mode: this.unmapMode(mode) }, { headers: this.authHeader });
  }

  mapMode(apiMode) {
    return apiMode === 'cool' ? 2 : apiMode === 'heat' ? 1 : 0;
  }

  unmapMode(hkMode) {
    return hkMode === 2 ? 'cool' : hkMode === 1 ? 'heat' : 'off';
  }
}

module.exports = SensiAPI;
```
