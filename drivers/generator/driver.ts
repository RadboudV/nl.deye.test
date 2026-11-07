import Homey from 'homey';

/**
 * The generator device can only be added for an existing Deye inverter device,
 * because it uses that device's Modbus connection. Pairing lists the inverter
 * devices that do not have a generator device yet; no IP address, port or unit id
 * is asked.
 */
module.exports = class DeyeGeneratorDriver extends Homey.Driver {

  async onInit() {
    this.log('Deye Generator Driver has been initialized');
  }

  async onPairListDevices() {
    const inverters = this.homey.drivers.getDriver('deye').getDevices();
    if (inverters.length === 0) {
      throw new Error(this.homey.__('pair.noinverter_generator'));
    }

    const taken = new Set(this.getDevices().map((d) => d.getStoreValue('inverterId')));
    const free = inverters.filter((inv) => !taken.has(inv.getData().id));
    if (free.length === 0) {
      throw new Error(this.homey.__('pair.allhavegenerator'));
    }

    return free.map((inv) => ({
      name: `${inv.getName()} generator`,
      data: { id: `${inv.getData().id}-generator` },
      store: { inverterId: inv.getData().id },
    }));
  }
};
