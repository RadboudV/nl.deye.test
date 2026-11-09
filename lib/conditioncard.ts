import type Homey from 'homey';
import type { Snapshot } from './registers';

/** A device that can hand out the latest inverter snapshot: the inverter itself, or a battery/solar/generator device linked to it. */
interface SnapshotDevice {
  getAvailable(): boolean;
  getSnapshot(): Snapshot;
}

/**
 * Registers the run listener of a flow condition card of a driver. The condition is evaluated
 * on the latest inverter snapshot (no Modbus traffic). The inverted wording ("Battery not
 * charging") is handled by Homey. Cards are registered once per driver, not per device, and
 * receive the chosen device as args.device.
 */
export function registerConditionCard(
  driver: Homey.Driver,
  id: string,
  what: string,
  test: (snapshot: Snapshot) => boolean | null,
) {
  driver.homey.flow.getConditionCard(id).registerRunListener(async (args: { device: SnapshotDevice }) => {
    const device = args.device;
    if (!device.getAvailable()) throw new Error('The Deye inverter is not available right now');
    const result = test(device.getSnapshot());
    if (result === null) throw new Error(`No ${what} reading from the inverter yet`);
    return result;
  });
}
