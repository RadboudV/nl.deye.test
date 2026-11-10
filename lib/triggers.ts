import type Homey from 'homey';

/**
 * Helpers for the flow trigger cards. Pure logic plus one thin wrapper around the Homey
 * device trigger card, so the rules can be tested without Homey.
 */

/** Number of consecutive polls a new state must be seen before a trigger fires. */
export const DEBOUNCE_POLLS = 2;

/**
 * Turns a noisy state (e.g. "grid present") into confirmed changes.
 * - the first valid reading is stored without a change (no trigger after an app restart)
 * - a different state must be seen `polls` times in a row before it is confirmed
 * - `null` (unknown) restarts the counting but keeps the confirmed state, so a reconnect
 *   only fires when the state really changed in the meantime
 */
export class StateDebouncer<T> {
  private confirmed: T | undefined;
  private candidate: T | undefined;
  private count = 0;

  constructor(private readonly polls = DEBOUNCE_POLLS) {}

  /** Returns the new state when it has just been confirmed as a change, otherwise null. */
  update(value: T | null): { value: T } | null {
    if (value === null) { this.reset(); return null; }
    if (this.confirmed === undefined) { this.confirmed = value; return null; }
    if (value === this.confirmed) { this.reset(); return null; }
    if (value !== this.candidate) { this.candidate = value; this.count = 0; }
    this.count += 1;
    if (this.count < this.polls) return null;
    this.confirmed = value;
    this.reset();
    return { value };
  }

  /** Forget the pending (not yet confirmed) change. */
  reset() { this.candidate = undefined; this.count = 0; }
}

/** Remembers the last value per key; tells whether a new value differs. The first value never counts as a change. */
export class ChangeTracker {
  private last = new Map<string, number>();

  changed(key: string, value: number): boolean {
    const previous = this.last.get(key);
    this.last.set(key, value);
    return previous !== undefined && previous !== value;
  }
}

/** Fires a driver-level trigger card for one device. Errors are logged, never thrown into the poll loop. */
export async function fireTrigger(
  device: Homey.Device,
  id: string,
  tokens: Record<string, unknown> = {},
) {
  await device.homey.flow.getDeviceTriggerCard(id).trigger(device, tokens).catch(device.error);
}
