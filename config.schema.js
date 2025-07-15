#**config.schema.json**

```json
{
  "pluginAlias": "HomebridgeSensi",
  "pluginType": "accessory",
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
      },
      "deviceId": {
        "title": "Device ID",
        "type": "string"
      }
    },
    "required": ["refreshToken", "deviceId"]
  }
}
```
