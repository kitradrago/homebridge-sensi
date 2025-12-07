
# Homebridge Sensi

A Homebridge plugin for Emerson Sensi thermostats using the official WebSocket API.  
Provides real‑time updates, automatic reconnect, and full HomeKit integration.

Created because I wanted a plugin for homebridge. I referenced the work of the 
HomeAssistant Sensi plugin made by @iprak (https://github.com/iprak/sensi) for parts of
the API Code.

---

## ✨ Features
- Real‑time thermostat and sensor updates via WebSocket
- Automatic reconnect and keep‑alive pings
- Control temperature, mode, fan, and circulating fan
- Proper Celsius conversion for HomeKit compatibility
- Simple configuration: only requires a refresh token

---

## 📦 Installation

1. Clone or download this repository.

2. From the plugin root, run:
   npm install
   npm run build
   npm install -g .

3. Restart Homebridge.


## ⚙️ Configuration

Use the Homebridge Config UI — you’ll see a single field for the Sensi Refresh Token.

If you are unable to configure via the UI for any reason, then:

Add the following to your Homebridge config.json:

json
{
  "platforms": [
    {
      "platform": "SensiPlatform",
      "refreshToken": "YOUR_REFRESH_TOKEN"
    }
  ]
}


## 🔑 Obtaining the Refresh Token

You need to capture the refresh_token from the Sensi web app (https://manager.sensicomfort.com). This requires opening Developer Tools in your browser and watching the network requests.

### Safari

Open Safari and go to Preferences → Advanced.
Enable “Show Develop menu in menu bar.”
Log in to manager.sensicomfort.com.
In the Develop menu, choose Show Web Inspector.
Go to the Storage Tab
Look for the refresh token under Session Storage
copy the token value and paste into the plugin config

### Chrome

Open Chrome and log in to manager.sensicomfort.com.
Press F12 or Cmd+Option+I (Mac) to open Developer Tools.
Go to the Network tab.
Reload the page if necessary.
Find the request to https://oauth.sensiapi.io/token.
Click it, then check the Response panel.
Copy the refresh_token value.

### Edge

Open Edge and log in to manager.sensicomfort.com.
Press F12 to open Developer Tools.
Go to the Network tab.
Reload the page if necessary.
Find the request to https://oauth.sensiapi.io/token.
Click it, then check the Response panel.
Copy the refresh_token value.

⚠️ Important: The refresh token is long and case‑sensitive. Paste it exactly into your Homebridge config.


## 📚 Development

Source code is in src/.
Run npm run build to compile to dist/.
Entry point is src/index.ts.

I welcome suggestion, improvements, and people interested in helping to maintain this plugin. Especially since chances are my ADHD will forget this even exists until mine stops working.

Thanks for downloading it!

Kitra Drago

