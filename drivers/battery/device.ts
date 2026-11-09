import { DeyeBattery, BATTERY_CAPABILITIES } from '../../lib/battery';
import { InverterLink } from '../../lib/inverterlink';
import type { Snapshot } from '../../lib/registers';

/**
 * Deye home battery.
 *
 * This device has NO Modbus connection of its own. The Deye inverter device
 * reads all registers (including the battery ones) and publishes them; this
 * device listens (see InverterLink) and decodes the battery part. It requires
 * the inverter device it was paired with (store value `inverterId`).
 */
class MyDeyeBatteryDevice extends DeyeBattery {
  private link = new InverterLink(
    this,
    (snapshot) => this.processBatteryResult(snapshot),
    'Deye inverter device not found. Add it again or re-add this battery.',
  );

  async onInit() {
    this.log('Deye battery device has been initialized');

    // Make sure every capability exists (also for devices created by older versions)
    for (const cap of BATTERY_CAPABILITIES) {
      if (!this.hasCapability(cap)) await this.addCapability(cap).catch(this.error);
    }
    this.link.start();
  }

  /** Latest snapshot of the linked inverter, used by the flow conditions of this driver. */
  getSnapshot(): Snapshot { return this.link.getSnapshot(); }

  async onUninit() { this.link.stop(); }
  async onDeleted() { this.link.stop(); }
}

module.exports = MyDeyeBatteryDevice;
