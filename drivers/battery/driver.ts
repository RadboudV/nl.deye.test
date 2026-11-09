import Homey from 'homey';
import * as conditions from '../../lib/conditions';
import { registerConditionCard } from '../../lib/conditioncard';

/**
 * The battery can only be added for an existing Deye inverter device, because
 * it uses that device's Modbus connection. Pairing therefore lists the
 * inverter devices that do not have a battery yet; no IP address, port or
 * unit id is asked.
 */
module.exports = class DeyeBatteryDriver extends Homey.Driver {

  async onInit() {
    this.log('Deye Battery Driver has been initialized');
    registerConditionCard(this, 'battery_charging', 'battery power', conditions.batteryCharging);
    registerConditionCard(this, 'battery_discharging', 'battery power', conditions.batteryDischarging);
  }

  async onPairListDevices() {
    const inverters = this.homey.drivers.getDriver('deye').getDevices();
    if (inverters.length === 0) {
      throw new Error(this.homey.__('pair.noinverter'));
    }

    const taken = new Set(this.getDevices().map((d) => d.getStoreValue('inverterId')));
    const free = inverters.filter((inv) => !taken.has(inv.getData().id));
    if (free.length === 0) {
      throw new Error(this.homey.__('pair.allhavebattery'));
    }

    return free.map((inv) => ({
      name: `${inv.getName()} battery`,
      data: { id: `${inv.getData().id}-battery` },
      store: { inverterId: inv.getData().id },
    }));
  }
};
