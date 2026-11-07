/**
 * Writes a capability value only when it differs from the last value that was
 * written successfully. Every setCapabilityValue call is a message to Homey
 * (insights, flows, UI), so skipping unchanged values saves CPU on every poll.
 *
 * The first value after an app start is always written (the cache is empty),
 * which also re-syncs the capability with the inverter.
 */
export class CapabilityWriter {
  private last = new Map<string, unknown>();

  constructor(private readonly device: { setCapabilityValue(capability: string, value: any): Promise<void> }) {}

  /** Resolves when written or skipped; rejects when Homey refuses (the value is then not cached, so it is retried). */
  async set(capability: string, value: unknown): Promise<void> {
    if (this.last.has(capability) && Object.is(this.last.get(capability), value)) return;
    await this.device.setCapabilityValue(capability, value);
    this.last.set(capability, value);
  }

  /** Forget the cached value(s), e.g. after a capability was removed and added again. */
  forget(capability?: string) {
    if (capability) this.last.delete(capability); else this.last.clear();
  }
}
