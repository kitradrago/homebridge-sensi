// sensi-api.js (updated using iprak/sensi API logic)

const axios = require('axios');

class SensiAPI {
  constructor(refreshToken, deviceId, log) {
    this.refreshToken = refreshToken;
    this.deviceId = deviceId;
    this.log = log;
    this.baseUrl = 'https://api.sensi.emerson.com/v1';
    this.accessToken = null;
  }

  async authenticate() {
    try {
      const response = await axios.post('https://api.sensi.emerson.com/v1/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });

      this.accessToken = response.data.access_token;
      this.log('Authenticated with new access token');
    } catch (err) {
      this.log.error('Authentication failed:', err.response ? err.response.data : err);
      throw new Error('Failed to authenticate with Sensi API');
    }
  }

  async getHeaders() {
    if (!this.accessToken) {
      await this.authenticate();
    }
    return {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  async getStatus() {
    const headers = await this.getHeaders();
    const url = `${this.baseUrl}/devices/${this.deviceId}/status`; 

    const res = await axios.get(url, { headers });
    const data = res.data;
    return {
      currentTemperature: data.indoorTemperatureC,  // Celsius
      targetTemperature: data.setPointC,          // Celsius
      mode: this.mapMode(data.systemMode)
    };
  }

  async setTemperature(temp) {
    const headers = await this.getHeaders();
    const url = `${this.baseUrl}/devices/${this.deviceId}/setpoints`;

    await axios.put(url, {
      heatSetPointC: temp,  // For heat mode
      coolSetPointC: temp   // For cool mode
    }, { headers });

    this.log(`Set temperature to ${temp}°C`);
  }

  async setMode(mode) {
    const headers = await this.getHeaders();
    const url = `${this.baseUrl}/devices/${this.deviceId}/system_mode`;

    await axios.put(url, {
      mode: this.unmapMode(mode)
    }, { headers });

    this.log(`Set mode to ${this.unmapMode(mode)}`);
  }

  mapMode(apiMode) {
    switch (apiMode) {
      case 'cool': return 2;
      case 'heat': return 1;
      case 'auto': return 3;
      case 'off': default: return 0;
    }
  }

  unmapMode(hkMode) {
    switch (hkMode) {
      case 2: return 'cool';
      case 1: return 'heat';
      case 3: return 'auto';
      case 0: default: return 'off';
    }
  }
}

module.exports = SensiAPI;

// ✅ This updated wrapper now:
// - Authenticates using refresh_token
// - Automatically gets and refreshes access_token
// - Talks to current Sensi cloud API endpoints
// - Maps HomeKit modes to Sensi modes
