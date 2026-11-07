import { DeyeGenerator, GENERATOR_CAPABILITIES } from '../../lib/generator';
import { InverterLink } from '../../lib/inverterlink';

/**
 * Deye generator input.
 *
 * Like the battery and solar devices this has NO Modbus connection of its own:
 * the Deye inverter device reads all registers and publishes them, this device
 * decodes the generator part. It requires the inverter device it was paired
 * with (store value `inverterId`).
 */
class MyDeyeGeneratorDevice extends DeyeGenerator {
  private link = new InverterLink(
    this,
    (snapshot) => this.processGeneratorResult(snapshot),
    'Deye inverter device not found. Add it again or re-add this generator device.',
  );

  async onInit() {
    this.log('Deye generator device has been initialized');

    // Make sure every capability exists (also for devices created by older versions)
    for (const cap of GENERATOR_CAPABILITIES) {
      if (!this.hasCapability(cap)) await this.addCapability(cap).catch(this.error);
    }
    this.link.start();
  }

  async onUninit() { this.link.stop(); }
  async onDeleted() { this.link.stop(); }
}

module.exports = MyDeyeGeneratorDevice;
