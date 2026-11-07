import { DeyeSolar, SOLAR_CAPABILITIES } from '../../lib/solar';
import { InverterLink } from '../../lib/inverterlink';

/**
 * Deye solar (PV inputs).
 *
 * Like the battery device this has NO Modbus connection of its own: the Deye
 * inverter device reads all registers and publishes them, this device decodes
 * the solar part. It requires the inverter device it was paired with (store
 * value `inverterId`).
 */
class MyDeyeSolarDevice extends DeyeSolar {
  private link = new InverterLink(
    this,
    (snapshot) => this.processSolarResult(snapshot),
    'Deye inverter device not found. Add it again or re-add this solar device.',
  );

  async onInit() {
    this.log('Deye solar device has been initialized');

    // Make sure every capability exists (also for devices created by older versions)
    for (const cap of SOLAR_CAPABILITIES) {
      if (!this.hasCapability(cap)) await this.addCapability(cap).catch(this.error);
    }
    this.link.start();
  }

  async onUninit() { this.link.stop(); }
  async onDeleted() { this.link.stop(); }
}

module.exports = MyDeyeSolarDevice;
