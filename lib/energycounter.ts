/**
 * Turns a power reading (W) into daily and total energy counters (kWh) by
 * integrating over time (trapezoid between two consecutive readings).
 *
 *  - The daily counter goes back to 0 when the local date changes (the first reading
 *    after 00:00 starts the new day, so within one polling interval of midnight).
 *  - Gaps longer than MAX_GAP_MS (app or inverter offline) are not integrated, so no
 *    energy is invented for a period without readings.
 *  - Negative power is measurement noise for a consumer and counts as 0.
 */
export const MAX_GAP_MS = 10 * 60 * 1000;

export interface CounterState {
  total: number;          // kWh
  daily: number;          // kWh
  day: string;            // local date of `daily`, YYYY-MM-DD
  ts: number | null;      // time of the previous reading (ms)
  power: number | null;   // previous reading (W)
}

export class OwnEnergyCounter {
  readonly state: CounterState;

  constructor(saved?: Partial<CounterState> | null) {
    const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    this.state = {
      total: ok(saved?.total) ? saved!.total : 0,
      daily: ok(saved?.daily) ? saved!.daily : 0,
      day: typeof saved?.day === 'string' ? saved.day : '',
      ts: ok(saved?.ts) ? saved!.ts : null,
      power: ok(saved?.power) ? saved!.power : null,
    };
  }

  /** Adds a reading. `day` is the current local date. Returns the new counters and whether the day rolled over. */
  update(powerW: number, nowMs: number, day: string): { daily: number; total: number; rolledOver: boolean } {
    const s = this.state;
    const rolledOver = s.day !== day;
    if (rolledOver) { s.daily = 0; s.day = day; }

    if (s.ts !== null && s.power !== null) {
      const dt = nowMs - s.ts;
      if (dt > 0 && dt <= MAX_GAP_MS) {
        const avg = (Math.max(0, s.power) + Math.max(0, powerW)) / 2;
        const kwh = (avg * dt) / 3_600_000_000;       // W * ms -> kWh
        s.daily += kwh;
        s.total += kwh;
      }
    }
    s.ts = nowMs;
    s.power = powerW;
    return { daily: s.daily, total: s.total, rolledOver };
  }
}
