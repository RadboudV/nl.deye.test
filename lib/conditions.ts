'use strict';

import { Snapshot } from './registers';

// ---------------------------------------------------------------------------
// Flow condition logic. Pure functions on the inverter snapshot, so they are
// easy to test and do not touch Modbus. A value that is not in the snapshot
// (not read yet, or rejected by the inverter) gives `null` = unknown.
// ---------------------------------------------------------------------------

/** Below this many watts the battery / grid is considered idle (measurement noise). */
export const BATTERY_IDLE_W = 10;
export const GRID_IDLE_W = 20;
export const SOLAR_MIN_W = 10;
/** A phase counts as "grid present" above this voltage. */
export const GRID_MIN_VOLTAGE = 80;

/** Snapshot value in real units (value * 10^scale), or null when missing. */
export function measured(snap: Snapshot, key: string): number | null {
  const m = snap[key];
  if (!m || m.value === 'xxx') return null;
  const n = Number(m.value) * Math.pow(10, Number(m.scale));
  return Number.isFinite(n) ? n : null;
}

/** Grid is present when at least one phase voltage is above GRID_MIN_VOLTAGE. */
export function gridAvailable(snap: Snapshot): boolean | null {
  const volts = ['l1gridvoltage', 'l2gridvoltage', 'l3gridvoltage']
    .map((k) => measured(snap, k)).filter((v): v is number => v !== null);
  if (volts.length === 0) return null;
  return Math.max(...volts) >= GRID_MIN_VOLTAGE;
}

/** Register 590 (battery power): positive = discharging, negative = charging. */
export function batteryCharging(snap: Snapshot): boolean | null {
  const p = measured(snap, 'batterypower');
  return p === null ? null : p < -BATTERY_IDLE_W;
}

export function batteryDischarging(snap: Snapshot): boolean | null {
  const p = measured(snap, 'batterypower');
  return p === null ? null : p > BATTERY_IDLE_W;
}

/** Register 625 (total grid power): positive = import, negative = export. */
export function gridFeeding(snap: Snapshot): boolean | null {
  const p = measured(snap, 'gridpower');
  return p === null ? null : p < -GRID_IDLE_W;
}

/** Sum of all PV inputs that are in the snapshot. */
export function solarProducing(snap: Snapshot): boolean | null {
  const p = ['pv1inputpower', 'pv2inputpower', 'pv3inputpower']
    .map((k) => measured(snap, k)).filter((v): v is number => v !== null);
  if (p.length === 0) return null;
  return p.reduce((a, b) => a + b, 0) >= SOLAR_MIN_W;
}
