import { API } from 'homebridge';
import { SensiPlatform } from './platform';

/**
 * This method registers the platform with Homebridge
 */
export = (api: API) => {
  api.registerPlatform('homebridge-sensi', 'SensiPlatform', SensiPlatform);
};
