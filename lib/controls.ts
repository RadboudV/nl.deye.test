// ---------------------------------------------------------------------------
// Control (write) logic for the Deye inverter flow cards.
//
// This file contains no Homey or Modbus-library code: everything goes through
// the small `RegisterIO` interface, which the inverter device implements while
// it holds the connection lock. That keeps the bit handling testable.
//
// Register facts used here (holding registers, 0-based addresses):
//   Time-of-use slots 1..6
//     148..153  start time, decimal HHMM (1430 = 14:30). A slot ends where the next one starts.
//     154..159  power limit [W]
//     166..171  minimum / target battery SOC [%]
//     172..177  flags:  bit0 0x01 grid charge   bit1 0x02 generator charge
//                       bits2-4 0x1C mode (None/General/Backup/Charge) -> never touched here
//                       bit5 0x20 solar selling for this slot
//   146  time of use: bit0 enable, bit1..7 = Monday..Sunday
//   141  energy pattern: bit0 0 = battery first, 1 = load first
//   142  work mode: 0 selling first, 1 zero export to load, 2 zero export to CT
//   104  zero export power [W], signed, scale x1 (confirmed on the inverter)
//   143  max sell power [W]            340  max solar power [W]
//   145  solar selling (global) 0/1
//   178  bits4-5 grid peak shaving: 0b10 = off, 0b11 = on      191  grid peak shaving power [W]
// ---------------------------------------------------------------------------

import type { RegisterSet } from './registers';

export interface RegisterIO {
  /** The register set of the inverter's communication protocol version: addresses are looked up by key. */
  set: RegisterSet;
  read(address: number, length: number): Promise<number[]>;
  /** Writes with function code 16 (write multiple registers), also for one value. */
  write(address: number, values: number[]): Promise<void>;
  pause(ms: number): Promise<void>;
}

/** A problem with the request or a refused write. The message is shown in the flow. */
export class ControlError extends Error {}

export type Flag = 'keep' | 'on' | 'off';

export const SLOT_COUNT = 6;

/** Address of a register by key, from the active register set. */
function addr(io: RegisterIO, key: string): number {
  const def = io.set.registers[key];
  if (!def) throw new ControlError(`"${key}" is not available on communication protocol ${io.set.name}`);
  return def.address;
}

/** First address of the six consecutive slot registers key1..key6. */
function slotBase(io: RegisterIO, prefix: string): number {
  const base = addr(io, `${prefix}1`);
  for (let n = 2; n <= SLOT_COUNT; n++) {
    if (addr(io, `${prefix}${n}`) !== base + n - 1) {
      throw new ControlError(`Timeslot registers "${prefix}" are not consecutive on communication protocol ${io.set.name}`);
    }
  }
  return base;
}

const FLAG_GRID = 0x01;
const FLAG_GENERATOR = 0x02;
const FLAG_SELL = 0x20;

const MAX_WORD = 0xffff;
export const MAX_POWER_W = 65535;

/** Pause between writes to different registers, and before reading back. */
export const WRITE_GAP_MS = 300;

// ---- helpers ---------------------------------------------------------------

const word = (v: number) => v & MAX_WORD;

export function applyFlag(value: number, mask: number, flag: Flag): number {
  if (flag === 'on') return word(value | mask);
  if (flag === 'off') return word(value & ~mask);
  return value;
}

/** '14:30' (also '1430', '14.30') -> 1430 */
export function parseTime(input: unknown): number {
  const m = /^\s*(\d{1,2})\s*[:.]?\s*(\d{2})(?:\s*[:.]\s*\d{2})?\s*$/.exec(String(input));
  const h = m ? Number(m[1]) : NaN;
  const min = m ? Number(m[2]) : NaN;
  if (!m || h > 23 || min > 59) throw new ControlError(`Invalid time "${input}", use HH:mm (for example 06:30)`);
  return h * 100 + min;
}

/** Empty / missing optional flow argument -> undefined, otherwise a number. */
export function optNumber(input: unknown, what: string): number | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  const n = Number(input);
  if (!Number.isFinite(n)) throw new ControlError(`${what} must be a number, got "${input}"`);
  return n;
}

/** Required number: an empty or missing value is an error (Number('') would silently be 0). */
export function reqNumber(input: unknown, what: string): number {
  const n = optNumber(input, what);
  if (n === undefined) throw new ControlError(`${what} is required`);
  return n;
}

export function toFlag(input: unknown, what: string): Flag {
  if (input === undefined || input === null || input === '' || input === 'keep') return 'keep';
  if (input === 'on' || input === 'off') return input;
  throw new ControlError(`${what}: unknown option "${input}"`);
}

function checkInt(value: number, min: number, max: number, what: string, unit = ''): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ControlError(`${what} must be a whole number between ${min} and ${max}${unit}, got ${value}`);
  }
  return value;
}

export function parseSlot(input: unknown): number {
  const slot = Number(input);
  if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) {
    throw new ControlError(`Timeslot must be 1 to ${SLOT_COUNT}, got "${input}"`);
  }
  return slot;
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Write, wait a moment, read back and compare. Throws when the inverter holds something else. */
async function writeVerified(io: RegisterIO, address: number, values: number[], what: string) {
  await io.write(address, values);
  await io.pause(WRITE_GAP_MS);
  const back = await io.read(address, values.length);
  if (!same(back, values)) {
    throw new ControlError(
      `Inverter did not accept ${what}: wrote ${values.join(',')} to register ${address}, read back ${back.join(',')}`,
    );
  }
}

/** Read-modify-write one register. `change` gets the current word and returns the new one. */
async function updateRegister(io: RegisterIO, address: number, change: (current: number) => number, what: string) {
  const [current] = await io.read(address, 1);
  const next = word(change(current));
  if (next === current) return;                      // nothing to do
  await writeVerified(io, address, [next], what);
}

// ---- time-of-use timeslots ---------------------------------------------------

export interface SlotChange {
  time?: unknown;            // 'HH:mm', empty = keep
  power?: unknown;           // W, empty = keep
  soc?: unknown;             // %, empty = keep
  grid?: unknown;            // 'keep' | 'on' | 'off'
  generator?: unknown;
  sell?: unknown;
}

interface ParsedChange {
  time?: number;
  power?: number;
  soc?: number;
  grid: Flag;
  generator: Flag;
  sell: Flag;
}

function parseChange(c: SlotChange, allowTime: boolean): ParsedChange {
  const power = optNumber(c.power, 'Power limit');
  const soc = optNumber(c.soc, 'Minimum SOC');
  const parsed: ParsedChange = {
    time: allowTime && c.time !== undefined && c.time !== null && c.time !== '' ? parseTime(c.time) : undefined,
    power: power === undefined ? undefined : checkInt(power, 0, MAX_POWER_W, 'Power limit', ' W'),
    soc: soc === undefined ? undefined : checkInt(soc, 0, 100, 'Minimum SOC', ' %'),
    grid: toFlag(c.grid, 'Grid charge'),
    generator: toFlag(c.generator, 'Generator charge'),
    sell: toFlag(c.sell, 'Solar selling'),
  };
  const nothing = parsed.time === undefined && parsed.power === undefined && parsed.soc === undefined
    && parsed.grid === 'keep' && parsed.generator === 'keep' && parsed.sell === 'keep';
  if (nothing) throw new ControlError('Nothing to change: every field is set to leave unchanged');
  return parsed;
}

const flagsChanged = (p: ParsedChange) => p.grid !== 'keep' || p.generator !== 'keep' || p.sell !== 'keep';

const applyFlags = (current: number, p: ParsedChange) =>
  applyFlag(applyFlag(applyFlag(current, FLAG_GRID, p.grid), FLAG_GENERATOR, p.generator), FLAG_SELL, p.sell);

/**
 * Change one timeslot. Only the fields that are set are written, and within
 * the flags register only the grid / generator / solar-sell bits are touched
 * (the mode bits stay as they are). The start time is written last, so the
 * slot only moves once its other settings are in place.
 */
export async function setTimeslot(io: RegisterIO, slotInput: unknown, change: SlotChange): Promise<void> {
  const slot = parseSlot(slotInput);
  const p = parseChange(change, true);
  const i = slot - 1;
  let first = true;
  const gap = async () => { if (!first) await io.pause(WRITE_GAP_MS); first = false; };

  if (p.power !== undefined) { await gap(); await writeVerified(io, slotBase(io, 'timeofusepower') + i, [p.power], `power limit of slot ${slot}`); }
  if (p.soc !== undefined) { await gap(); await writeVerified(io, slotBase(io, 'timeofusesoc') + i, [p.soc], `minimum SOC of slot ${slot}`); }
  if (flagsChanged(p)) {
    await gap();
    await updateRegister(io, slotBase(io, 'timeofusechargeenable') + i, (cur) => applyFlags(cur, p), `charge options of slot ${slot}`);
  }
  if (p.time !== undefined) { await gap(); await writeVerified(io, slotBase(io, 'timeofusetime') + i, [p.time], `start time of slot ${slot}`); }
}

/** Same values for all six slots. Start times are never changed. Three block writes. */
export async function setAllTimeslots(io: RegisterIO, change: SlotChange): Promise<void> {
  const p = parseChange(change, false);
  let first = true;
  const gap = async () => { if (!first) await io.pause(WRITE_GAP_MS); first = false; };

  if (p.power !== undefined) {
    await gap();
    await writeVerified(io, slotBase(io, 'timeofusepower'), Array(SLOT_COUNT).fill(p.power), 'power limit of all slots');
  }
  if (p.soc !== undefined) {
    await gap();
    await writeVerified(io, slotBase(io, 'timeofusesoc'), Array(SLOT_COUNT).fill(p.soc), 'minimum SOC of all slots');
  }
  if (flagsChanged(p)) {
    await gap();
    const flagsBase = slotBase(io, 'timeofusechargeenable');
    const current = await io.read(flagsBase, SLOT_COUNT);
    const next = current.map((w) => word(applyFlags(w, p)));       // per slot: other bits (mode) preserved
    if (!same(current, next)) await writeVerified(io, flagsBase, next, 'charge options of all slots');
  }
}

// ---- other controls -----------------------------------------------------------

export const WORK_MODES: Record<string, number> = {
  selling_first: 0,
  zero_export_to_load: 1,
  zero_export_to_ct: 2,
};

/** Zero export power in W, signed 16 bit, scale x1. Range as in the Sunsynk/Deye definitions. */
export const ZERO_EXPORT_MIN_W = -500;
export const ZERO_EXPORT_MAX_W = 500;

function parseZeroExportPower(input: unknown): number | undefined {
  const w = optNumber(input, 'Zero export power');
  return w === undefined ? undefined : checkInt(w, ZERO_EXPORT_MIN_W, ZERO_EXPORT_MAX_W, 'Zero export power', ' W');
}

export async function setZeroExportPower(io: RegisterIO, watts: unknown) {
  const w = parseZeroExportPower(watts);
  if (w === undefined) throw new ControlError('Zero export power is required');
  await writeVerified(io, addr(io, 'zeroexportpower'), [word(w)], 'zero export power');
}

/** Work mode, optionally together with the zero export power (written first, so it is in place when the mode switches). */
export async function setWorkMode(io: RegisterIO, mode: unknown, zeroExportPower?: unknown) {
  const value = WORK_MODES[String(mode)];
  if (value === undefined) throw new ControlError(`Unknown work mode "${mode}"`);
  const w = parseZeroExportPower(zeroExportPower);
  if (w !== undefined) {
    await writeVerified(io, addr(io, 'zeroexportpower'), [word(w)], 'zero export power');
    await io.pause(WRITE_GAP_MS);
  }
  await writeVerified(io, addr(io, 'workmode'), [value], 'work mode');
}

export async function setMaxSellPower(io: RegisterIO, watts: unknown) {
  await writeVerified(io, addr(io, 'maxsellpower'), [checkInt(reqNumber(watts, 'Max sell power'), 0, MAX_POWER_W, 'Max sell power', ' W')], 'max sell power');
}

export async function setMaxSolarPower(io: RegisterIO, watts: unknown) {
  await writeVerified(io, addr(io, 'maxsolarpower'), [checkInt(reqNumber(watts, 'Max solar power'), 0, MAX_POWER_W, 'Max solar power', ' W')], 'max solar power');
}

export async function setSolarSell(io: RegisterIO, state: unknown) {
  if (state !== 'on' && state !== 'off') throw new ControlError(`Solar selling must be on or off, got "${state}"`);
  await writeVerified(io, addr(io, 'solarsell'), [state === 'on' ? 1 : 0], 'solar selling');
}

export async function setEnergyPattern(io: RegisterIO, pattern: unknown) {
  if (pattern !== 'batt_first' && pattern !== 'load_first') {
    throw new ControlError(`Unknown energy pattern "${pattern}"`);
  }
  const loadFirst = pattern === 'load_first';
  await updateRegister(io, addr(io, 'energypattern'), (cur) => (loadFirst ? cur | 0x01 : cur & ~0x01), 'energy pattern');
}

export async function setGridPeakShavingOn(io: RegisterIO, watts: unknown) {
  const w = checkInt(reqNumber(watts, 'Grid peak shaving power'), 0, MAX_POWER_W, 'Grid peak shaving power', ' W');
  await writeVerified(io, addr(io, 'gridpeakshavingpower'), [w], 'grid peak shaving power');       // power first, then enable
  await io.pause(WRITE_GAP_MS);
  await updateRegister(io, addr(io, 'gridpeakshavingmode'), (cur) => (cur & ~0x30) | 0x30, 'grid peak shaving');
}

export async function setGridPeakShavingOff(io: RegisterIO) {
  await updateRegister(io, addr(io, 'gridpeakshavingmode'), (cur) => (cur & ~0x30) | 0x20, 'grid peak shaving');
}

export async function setTimeOfUseEnabled(io: RegisterIO, state: unknown) {
  if (state !== 'on' && state !== 'off') throw new ControlError(`Time of use must be on or off, got "${state}"`);
  await updateRegister(io, addr(io, 'timeofuseweeklysellingschedule'), (cur) => (state === 'on' ? cur | 0x01 : cur & ~0x01), 'time of use');
}

/** day: 1 = Monday ... 7 = Sunday (bits 1..7 of register 146) */
export async function setTimeOfUseDay(io: RegisterIO, dayInput: unknown, state: unknown) {
  const day = Number(dayInput);
  if (!Number.isInteger(day) || day < 1 || day > 7) throw new ControlError(`Day must be 1 (Monday) to 7 (Sunday), got "${dayInput}"`);
  if (state !== 'on' && state !== 'off') throw new ControlError(`Time of use day must be on or off, got "${state}"`);
  const mask = 1 << day;
  await updateRegister(io, addr(io, 'timeofuseweeklysellingschedule'), (cur) => (state === 'on' ? cur | mask : cur & ~mask), `time of use day ${day}`);
}

/** Raw write for advanced users. The device only calls this when the setting allows it. */
export async function writeRawRegister(io: RegisterIO, address: unknown, value: unknown) {
  const a = checkInt(reqNumber(address, 'Register address'), 0, MAX_WORD, 'Register address');
  const v = checkInt(reqNumber(value, 'Value'), 0, MAX_WORD, 'Value');
  await io.write(a, [v]);
}
