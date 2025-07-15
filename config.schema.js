{
  "pluginAlias": "HomebridgeSensi",
  "pluginType": "accessory",
  "singular": true,
  "schema": {
    "type": "object",
    "properties": {
      "name": {
        "title": "Name",
        "type": "string",
        "default": "Sensi Thermostat"
      },
      "refreshToken": {
        "title": "Refresh Token",
        "type": "string"
      }
    },
    "required": ["refreshToken"]
  }
}
