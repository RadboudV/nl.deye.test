import { ControlError, RegisterIO, WRITE_GAP_MS } from './controls';

// ---------------------------------------------------------------------------
// Inverter clock (registers 62..64, local time):
//   62  high byte = year - 2000, low byte = month
//   63  high byte = day,         low byte = hour
//   64  high byte = minute,      low byte = second
// Sync = write Homey's local time into these registers. The daily check refuses to touch a clock
// that is more than MAX_DELTA_MS off: then something else changed it and the sync switches itself off.
// ---------------------------------------------------------------------------

export const TIME_REGISTER = 62;
export const TIME_REGISTER_COUNT = 3;
export const MAX_DELTA_MS = 60_000;
export const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** After writing, the clock read back may differ this much (clock keeps running, rounding). */
const VERIFY_TOLERANCE_MS = 10_000;

export interface TimeParts { year: number; month: number; day: number; hour: number; minute: number; second: number; }

export function encodeTime(p: TimeParts): number[] {
  return [((p.year - 2000) << 8) | p.month, (p.day << 8) | p.hour, (p.minute << 8) | p.second];
}

/** null when the registers do not hold a valid date and time. */
export function decodeTime(words: number[]): TimeParts | null {
  if (words.length < TIME_REGISTER_COUNT) return null;
  const p: TimeParts = {
    year: 2000 + (words[0] >> 8), month: words[0] & 0xff,
    day: words[1] >> 8, hour: words[1] & 0xff,
    minute: words[2] >> 8, second: words[2] & 0xff,
  };
  const valid = p.month >= 1 && p.month <= 12 && p.day >= 1 && p.day <= 31
    && p.hour <= 23 && p.minute <= 59 && p.second <= 59;
  return valid ? p : null;
}

/** Local date and time in a time zone (for example Homey's: Europe/Amsterdam). */
export function localParts(ms: number, timeZone: string): TimeParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find((x) => x.type === type)?.value);
  return { year: n('year'), month: n('month'), day: n('day'), hour: n('hour'), minute: n('minute'), second: n('second') };
}

/** Wall clock reading as a number (the same offset for both sides, so differences are exact). */
const wallMs = (p: TimeParts) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);

export type SyncResult =
  | { status: 'synced'; deltaMs: number | null }      // deltaMs = inverter minus Homey, before the write (null: no valid time in the inverter)
  | { status: 'too-far'; deltaMs: number | null };    // nothing written

export function formatDelta(deltaMs: number | null): string {
  if (deltaMs === null) return 'no valid time in the inverter';
  const s = Math.round(Math.abs(deltaMs) / 1000);
  const text = s >= 120 ? `${Math.round(s / 60)} minutes` : `${s} seconds`;
  return deltaMs === 0 ? 'no difference' : `${text} ${deltaMs > 0 ? 'ahead' : 'behind'}`;
}

/**
 * Sets the inverter clock to Homey's time.
 * force = false (daily check): refuse when the inverter clock is more than MAX_DELTA_MS off or invalid.
 * force = true (the user just switched the sync on): write whatever the difference is.
 */
export async function syncInverterTime(
  io: RegisterIO,
  timeZone: string,
  force: boolean,
  clock: () => number = Date.now,
): Promise<SyncResult> {
  const current = decodeTime(await io.read(TIME_REGISTER, TIME_REGISTER_COUNT));
  const deltaMs = current ? wallMs(current) - wallMs(localParts(clock(), timeZone)) : null;
  if (!force && (deltaMs === null || Math.abs(deltaMs) > MAX_DELTA_MS)) return { status: 'too-far', deltaMs };

  const target = localParts(clock(), timeZone);
  if (target.year < 2000 || target.year > 2255) throw new ControlError(`Year ${target.year} cannot be stored in the inverter`);
  await io.write(TIME_REGISTER, encodeTime(target));
  await io.pause(WRITE_GAP_MS);
  const back = decodeTime(await io.read(TIME_REGISTER, TIME_REGISTER_COUNT));
  if (!back || Math.abs(wallMs(back) - wallMs(localParts(clock(), timeZone))) > VERIFY_TOLERANCE_MS) {
    throw new ControlError('The inverter did not accept the new time');
  }
  return { status: 'synced', deltaMs };
}
