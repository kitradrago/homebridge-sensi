import {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from "homebridge";

import { SensiAPI, DeviceStatePacket } from "./sensi-api";
import { SensiThermostatAccessory } from "./sensi-thermostat-accessory";
import { SensiSensorAccessory } from "./sensi-sensor-accessory";

export class SensiPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly api: API;
  private readonly config: PlatformConfig;
  private readonly accessories: PlatformAccessory[] = [];
  private readonly configuredDevices = new Set<string>();
  private sensiApi!: SensiAPI;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;
    this.config = config;

    this.api.on("didFinishLaunching", () => {
      this.initialize().catch((e) => this.log.error("[Sensi] Init error:", e));
    });
  }

  async initialize(): Promise<void> {
    if (!this.config.refreshToken) {
      this.log.warn("[Sensi] Refresh token missing – cannot connect.");
      return;
    }

    try {
      this.sensiApi = new SensiAPI(
        this.config.refreshToken as string,
        this.log,
        this.config.deviceId as string | undefined,
      );
      await this.sensiApi.authenticate();
      await this.sensiApi.connect();

      this.sensiApi.onDeviceUpdate((dev: DeviceStatePacket) => {
        this.handleDeviceUpdate(dev);
      });

      this.log.info("[Sensi] Platform initialized successfully");
    } catch (error) {
      this.log.error(
        "[Sensi] Initialization failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Called by Homebridge on startup for every accessory that was cached
   * from a previous run (found in ~/.homebridge/accessories/cachedAccessories).
   * We only stash it here — the actual service/handler wiring happens in
   * handleDeviceUpdate() once we know the device is still present, since
   * that's where we have access to the live SensiAPI instance.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(
      `[Sensi] Restoring cached accessory: ${accessory.displayName}`,
    );
    this.accessories.push(accessory);
  }

  private handleDeviceUpdate(dev: DeviceStatePacket): void {
    if (!dev.icd_id) {
      this.log.warn("[Sensi] Device update missing icd_id");
      return;
    }

    const id = dev.icd_id.toLowerCase();

    // Only wire up handlers for each device once per platform lifetime
    if (this.configuredDevices.has(id)) {
      return;
    }
    this.configuredDevices.add(id);

    const name = dev.registration?.name ?? "Sensi Thermostat";
    const uuid = this.api.hap.uuid.generate(id);

    // Reuse the cached accessory if Homebridge already restored one for
    // this UUID, instead of always creating (and re-registering) a new one.
    let accessory = this.accessories.find((a) => a.UUID === uuid);
    const isNewAccessory = !accessory;

    if (!accessory) {
      accessory = new this.api.platformAccessory(name, uuid);
      accessory.context.deviceId = id;
    } else {
      // Keep name/context fresh in case it changed since last cache
      accessory.displayName = name;
      accessory.context.deviceId = id;
    }

    try {
      // Register thermostat accessory
      new SensiThermostatAccessory(
        this.log,
        accessory,
        this.sensiApi,
        this.api.hap,
      );

      // Register sensor accessory
      new SensiSensorAccessory(
        this.log,
        accessory,
        this.sensiApi,
        this.api.hap,
      );

      if (isNewAccessory) {
        this.api.registerPlatformAccessories(
          "homebridge-sensi",
          "SensiPlatform",
          [accessory],
        );
        this.accessories.push(accessory);
        this.log.info(`[Sensi] Registered new device: ${name} (${id})`);
      } else {
        this.log.info(`[Sensi] Re-wired cached device: ${name} (${id})`);
      }
    } catch (error) {
      this.log.error(
        `[Sensi] Failed to register device ${name}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
