import Homey from 'homey';
import * as conditions from '../../lib/conditions';
import { registerConditionCard } from '../../lib/conditioncard';

/**
 * The solar device can only be added for an existing Deye inverter device,
 * because it uses that device's Modbus connection. Pairing lists the inverter
 * devices that do not have a solar device yet; no IP address, port or unit id
 * is asked.
 */
module.exports = class DeyeSolarDriver extends Homey.Driver {

  async onInit() {
    this.log('Deye Solar Driver has been initialized');
    registerConditionCard(this, 'solar_production', 'solar power', conditions.solarProducing);
  }

  async onPairListDevices() {
    const inverters = this.homey.drivers.getDriver('deye').getDevices();
    if (inverters.length === 0) {
      throw new Error(this.homey.__('pair.noinverter_solar'));
    }

    const taken = new Set(this.getDevices().map((d) => d.getStoreValue('inverterId')));
    const free = inverters.filter((inv) => !taken.has(inv.getData().id));
    if (free.length === 0) {
      throw new Error(this.homey.__('pair.allhavesolar'));
    }

    return free.map((inv) => ({
      name: `${inv.getName()} solar`,
      data: { id: `${inv.getData().id}-solar` },
      store: { inverterId: inv.getData().id },
    }));
  }
};
