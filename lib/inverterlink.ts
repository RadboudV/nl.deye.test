import type Homey from 'homey';
import type { Snapshot, SnapshotSource } from './registers';

// How often to check that we are still attached to the right inverter device
const WATCHDOG_INTERVAL_MS = 30_000;

/**
 * Links a child device (battery, solar) to its Deye inverter device.
 *
 * The child never opens a Modbus connection: the inverter device reads all
 * registers and publishes a snapshot on its event bus. The inverter is looked
 * up by the store value `inverterId`, re-checked every 30 s (the inverter may
 * initialise after the child, or be replaced) and the child is set unavailable
 * while the inverter is missing or unreachable. Snapshots are processed one at
 * a time; when several arrive meanwhile only the newest is kept.
 */
export class InverterLink {
  private inverter: SnapshotSource | null = null;
  private watchdog?: NodeJS.Timeout;
  private processing = false;
  private pending: Snapshot | null = null;
  private missingReported = false;

  constructor(
    private readonly device: Homey.Device,
    private readonly process: (snapshot: Snapshot) => Promise<void>,
    private readonly missingMessage: string,
  ) {}

  start() {
    this.sync();
    this.watchdog = this.device.homey.setInterval(() => this.sync(), WATCHDOG_INTERVAL_MS);
  }

  stop() {
    if (this.watchdog) this.device.homey.clearInterval(this.watchdog);
    this.watchdog = undefined;
    this.detach();
  }

  private find(): SnapshotSource | null {
    const inverterId = this.device.getStoreValue('inverterId');
    try {
      const found = this.device.homey.drivers.getDriver('deye').getDevices()
        .find((d) => d.getData().id === inverterId);
      return (found as unknown as SnapshotSource) ?? null;
    } catch (err) {
      return null;     // deye driver not ready yet
    }
  }

  private sync() {
    const found = this.find();
    if (found && found === this.inverter) return;

    this.detach();
    if (!found) {
      // report once (not every 30 s) and also when the inverter was never found
      if (!this.missingReported) {
        this.missingReported = true;
        this.device.setUnavailable(this.missingMessage).catch(this.device.error);
      }
      return;
    }
    this.missingReported = false;
    this.inverter = found;
    found.bus.on('snapshot', this.onSnapshot);
    found.bus.on('availability', this.onAvailability);

    this.onAvailability(found.getAvailable());
    const snapshot = found.getSnapshot();
    if (Object.keys(snapshot).length > 0) this.onSnapshot(snapshot);
  }

  private detach() {
    if (this.inverter) {
      this.inverter.bus.off('snapshot', this.onSnapshot);
      this.inverter.bus.off('availability', this.onAvailability);
    }
    this.inverter = null;
  }

  private onAvailability = (available: boolean) => {
    if (available) this.device.setAvailable().catch(this.device.error);
    else this.device.setUnavailable('Deye inverter not reachable').catch(this.device.error);
  };

  private onSnapshot = (snapshot: Snapshot) => {
    if (this.processing) { this.pending = snapshot; return; }
    this.processing = true;
    this.process(snapshot)
      .catch(this.device.error)
      .finally(() => {
        this.processing = false;
        const next = this.pending;
        this.pending = null;
        if (next) this.onSnapshot(next);
      });
  };
}
