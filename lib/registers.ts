import type { EventEmitter } from 'events';
import type * as Modbus from 'jsmodbus';

// ---------------------------------------------------------------------------
// Single source of truth for every Deye register the app reads.
//
// The register map depends on the inverter's communication protocol version
// (register 2, for example 0x0104 = v1.04). There is one RegisterSet per known
// version. The inverter device reads register 2 on every poll and uses the
// matching set; an unknown version makes the device unavailable instead of
// decoding values with the wrong map. To support another version, add a set
// with deriveSet() (see the end of the register table) and list it in REGISTER_SETS.
//
// The INVERTER device is the only code that talks Modbus. It reads all groups
// below in one cycle and keeps the result as a Snapshot. The battery device
// never opens a connection: it only decodes its own groups from the inverter's snapshot
// (battery: `battery` + `batterysettings`, solar: `solar`, generator: `generator`).
// ---------------------------------------------------------------------------

export type RegisterType = 'UINT16' | 'INT16' | 'UINT32' | 'STRING' | 'HEX';

/**
 * info            serial, rated power, firmware versions       (inverter device settings)
 * inverter        grid, load, CTs, temperatures                 (inverter device)
 * generator       generator input (voltage, power, energy)      (generator device)
 * solar           PV inputs and solar energy counters           (solar device, also kept on the inverter device)
 * battery         live battery values and energy counters       (battery device)
 * batterysettings BMS charge/discharge limits (read only)       (battery device)
 * tou             time-of-use schedule                          (inverter device)
 * misc            other inverter options                        (inverter device)
 */
export type RegisterGroup = 'info' | 'inverter' | 'solar' | 'generator' | 'battery' | 'batterysettings' | 'tou' | 'misc';

export interface RegisterDef {
  address: number;      // holding register address (0-based, as sent on the wire)
  length: number;       // number of 16-bit registers
  type: RegisterType;
  label: string;
  scale: number;        // power of ten: value * 10^scale
  group: RegisterGroup;
}

/** One decoded value. `value` is the raw (unscaled) number as a string. */
export interface Measurement {
  value: string;
  scale: number;
  label: string;
  /** register group, so a device can pick its part of the snapshot (e.g. the solar device takes 'solar') */
  group: RegisterGroup;
}

/** key -> decoded value. A key that could not be read is simply absent. */
export type Snapshot = Record<string, Measurement>;

/** What the battery device needs from the inverter device. */
export interface SnapshotSource {
  /** emits 'snapshot' (Snapshot) after each poll and 'availability' (boolean) on changes */
  bus: EventEmitter;
  getSnapshot(): Snapshot;
  getAvailable(): boolean;
}

const V104_REGISTERS: Record<string, RegisterDef> = {
  serial: { address: 3, length: 5, type: 'STRING', label: 'Serial Number', scale: 0, group: 'info' },
  ratedpower: { address: 20, length: 2, type: 'UINT32', label: 'Rated Power', scale: -1, group: 'info' },
  controlpanelversion1: { address: 14, length: 1, type: 'HEX', label: 'Control Panel Version1', scale: 0, group: 'info' },
  controlpanelversion2: { address: 15, length: 1, type: 'HEX', label: 'Control Panel Version2', scale: 0, group: 'info' },
  HMIversion1: { address: 17, length: 1, type: 'HEX', label: 'HMI Version 1', scale: 0, group: 'info' },
  HMIversion2: { address: 18, length: 1, type: 'HEX', label: 'HMI Version 2', scale: 0, group: 'info' },
  pv1inputpower: { address: 672, length: 1, type: 'UINT16', label: 'PV1 Input Power', scale: 0, group: 'solar' },
  pv2inputpower: { address: 673, length: 1, type: 'UINT16', label: 'PV2 Input Power', scale: 0, group: 'solar' },
  pv1voltage: { address: 676, length: 1, type: 'UINT16', label: 'PV1 Voltage', scale: -1, group: 'solar' },
  pv1current: { address: 677, length: 1, type: 'UINT16', label: 'PV1 Current', scale: -1, group: 'solar' },
  pv2voltage: { address: 678, length: 1, type: 'UINT16', label: 'PV2 Voltage', scale: -1, group: 'solar' },
  pv2current: { address: 679, length: 1, type: 'UINT16', label: 'PV2 Current', scale: -1, group: 'solar' },
  dailysolarproduction: { address: 529, length: 1, type: 'UINT16', label: 'Daily Solar Production', scale: -1, group: 'solar' },
  totalsolarproduction: { address: 534, length: 2, type: 'UINT32', label: 'Total Solar Production', scale: -1, group: 'solar' },
  gridpower: { address: 625, length: 1, type: 'INT16', label: 'Total Grid Power', scale: 0, group: 'inverter' },
  l1gridvoltage: { address: 598, length: 1, type: 'UINT16', label: 'L1 Grid Voltage', scale: -1, group: 'inverter' },
  l2gridvoltage: { address: 599, length: 1, type: 'UINT16', label: 'L2 Grid Voltage', scale: -1, group: 'inverter' },
  l3gridvoltage: { address: 600, length: 1, type: 'UINT16', label: 'L3 Grid Voltage', scale: -1, group: 'inverter' },
  internalctl1power: { address: 604, length: 1, type: 'INT16', label: 'Internal CT L1 Power', scale: 0, group: 'inverter' },
  internalctl2power: { address: 605, length: 1, type: 'INT16', label: 'Internal CT L2 Power', scale: 0, group: 'inverter' },
  internalctl3power: { address: 606, length: 1, type: 'INT16', label: 'Internal CT L3 Power', scale: 0, group: 'inverter' },
  externalctl1power: { address: 616, length: 1, type: 'INT16', label: 'External CT L1 Power', scale: 0, group: 'inverter' },
  externalctl2power: { address: 617, length: 1, type: 'INT16', label: 'External CT L2 Power', scale: 0, group: 'inverter' },
  externalctl3power: { address: 618, length: 1, type: 'INT16', label: 'External CT L3 Power', scale: 0, group: 'inverter' },
  dailyenergybought: { address: 520, length: 1, type: 'UINT16', label: 'Daily Energy Bought', scale: -1, group: 'inverter' },
  totalenergybought: { address: 522, length: 2, type: 'UINT32', label: 'Total Energy Bought', scale: -1, group: 'inverter' },
  dailyenergysold: { address: 521, length: 1, type: 'UINT16', label: 'Daily Energy Sold', scale: -1, group: 'inverter' },
  totalenergysold: { address: 524, length: 2, type: 'UINT32', label: 'Total Energy Sold', scale: -1, group: 'inverter' },
  l1current: { address: 630, length: 1, type: 'INT16', label: 'L1 Current', scale: -2, group: 'inverter' },
  l2current: { address: 631, length: 1, type: 'INT16', label: 'L2 Current', scale: -2, group: 'inverter' },
  l3current: { address: 632, length: 1, type: 'INT16', label: 'L3 Current', scale: -2, group: 'inverter' },
  l1inverterpower: { address: 633, length: 1, type: 'INT16', label: 'Inverter L1 Power', scale: 0, group: 'inverter' },
  l2inverterpower: { address: 634, length: 1, type: 'INT16', label: 'Inverter L2 Power', scale: 0, group: 'inverter' },
  l3inverterpower: { address: 635, length: 1, type: 'INT16', label: 'Inverter L3 Power', scale: 0, group: 'inverter' },
  heatsinktemperature: { address: 541, length: 1, type: 'UINT16', label: 'HeatSink Temperature', scale: 0, group: 'inverter' },
  inverterfrequency: { address: 638, length: 1, type: 'UINT16', label: 'Inverter Frequency', scale: -2, group: 'inverter' },
  loadfrequency: { address: 655, length: 1, type: 'UINT16', label: 'Load Frequency', scale: -2, group: 'inverter' },
  gridfrequency: { address: 609, length: 1, type: 'UINT16', label: 'Grid Frequency', scale: -2, group: 'inverter' },
  batterytodaycharge: { address: 514, length: 1, type: 'UINT16', label: 'Today battery charge', scale: -1, group: 'battery' },
  batterytodaydischarge: { address: 515, length: 1, type: 'UINT16', label: 'Today battery discharge', scale: -1, group: 'battery' },
  batterytotalcharge: { address: 516, length: 2, type: 'UINT32', label: 'Total battery charge', scale: -1, group: 'battery' },
  batterytotaldischarge: { address: 518, length: 2, type: 'UINT32', label: 'Total battery discharge', scale: -1, group: 'battery' },
  batterypower: { address: 590, length: 1, type: 'INT16', label: 'Power from Battery', scale: 0, group: 'battery' },
  batteryvoltage: { address: 587, length: 1, type: 'UINT16', label: 'Battery Voltage', scale: -2, group: 'battery' },
  batterycurrent: { address: 591, length: 1, type: 'INT16', label: 'Battery Current', scale: -2, group: 'battery' },
  batterypercentage: { address: 588, length: 1, type: 'UINT16', label: 'Battery SOC', scale: 0, group: 'battery' },
  batterytemperature: { address: 586, length: 1, type: 'UINT16', label: 'Battery Temperature', scale: 0, group: 'battery' },
  batterysettingschargevoltage: { address: 210, length: 1, type: 'UINT16', label: 'Settings: Max. Charge Voltage', scale: -2, group: 'batterysettings' },
  batterysettingschargecurrent: { address: 212, length: 1, type: 'UINT16', label: 'Settings: Charge Current', scale: 0, group: 'batterysettings' },
  batterysettingsdischargecurrent: { address: 213, length: 1, type: 'UINT16', label: 'Settings: Discharge Current', scale: 0, group: 'batterysettings' },
  batterysettingsmaxchargecurrent: { address: 218, length: 1, type: 'UINT16', label: 'Settings: Max. Charge Current', scale: 0, group: 'batterysettings' },
  batterysettingsmaxdischargecurrent: { address: 219, length: 1, type: 'UINT16', label: 'Settings: Max. Discharge Current', scale: 0, group: 'batterysettings' },
  loadtotalpower: { address: 653, length: 1, type: 'INT16', label: 'Total Load Power', scale: 0, group: 'inverter' },
  loadl1power: { address: 650, length: 1, type: 'INT16', label: 'Load L1 Power', scale: 0, group: 'inverter' },
  loadl2power: { address: 651, length: 1, type: 'INT16', label: 'Load L2 Power', scale: 0, group: 'inverter' },
  loadl3power: { address: 652, length: 1, type: 'INT16', label: 'Load L3 Power', scale: 0, group: 'inverter' },
  loadl1voltage: { address: 644, length: 1, type: 'UINT16', label: 'Load L1 Voltage', scale: -1, group: 'inverter' },
  loadl2voltage: { address: 645, length: 1, type: 'UINT16', label: 'Load L2 Voltage', scale: -1, group: 'inverter' },
  loadl3voltage: { address: 646, length: 1, type: 'UINT16', label: 'Load L3 Voltage', scale: -1, group: 'inverter' },
  loaddailyconsumption: { address: 526, length: 1, type: 'UINT16', label: 'Daily Load Consumption', scale: -1, group: 'inverter' },
  loadtotalconsumption: { address: 527, length: 2, type: 'UINT32', label: 'Total Load Consumption', scale: -1, group: 'inverter' },
  generatortotalpower: { address: 667, length: 1, type: 'INT16', label: 'Generator Total Power', scale: 0, group: 'generator' },
  generatorl1power: { address: 664, length: 1, type: 'INT16', label: 'Generator L1 Power', scale: 0, group: 'generator' },
  generatorl2power: { address: 665, length: 1, type: 'INT16', label: 'Generator L2 Power', scale: 0, group: 'generator' },
  generatorl3power: { address: 666, length: 1, type: 'INT16', label: 'Generator L3 Power', scale: 0, group: 'generator' },
  generatorl1voltage: { address: 661, length: 1, type: 'UINT16', label: 'Generator L1 Voltage', scale: -1, group: 'generator' },
  generatorl2voltage: { address: 662, length: 1, type: 'UINT16', label: 'Generator L2 Voltage', scale: -1, group: 'generator' },
  generatorl3voltage: { address: 663, length: 1, type: 'UINT16', label: 'Generator L3 Voltage', scale: -1, group: 'generator' },
  generatordailyproduction: { address: 536, length: 1, type: 'UINT16', label: 'Daily Generator Production', scale: 0, group: 'generator' },
  generatorpeakshavingpower: { address: 190, length: 1, type: 'UINT16', label: 'Generator Peak Shaving Power', scale: 0, group: 'generator' },
  generatorworkingtime: { address: 512, length: 2, type: 'UINT32', label: 'Generator Working Time in Hours', scale: -1, group: 'generator' },
  timeofuseweeklysellingschedule: { address: 146, length: 1, type: 'UINT16', label: 'Time of Use Weekly Selling Schedule', scale: 0, group: 'tou' },
  timeofusetime1: { address: 148, length: 1, type: 'UINT16', label: 'Time of Use Time 1', scale: 0, group: 'tou' },
  timeofusetime2: { address: 149, length: 1, type: 'UINT16', label: 'Time of Use Time 2', scale: 0, group: 'tou' },
  timeofusetime3: { address: 150, length: 1, type: 'UINT16', label: 'Time of Use Time 3', scale: 0, group: 'tou' },
  timeofusetime4: { address: 151, length: 1, type: 'UINT16', label: 'Time of Use Time 4', scale: 0, group: 'tou' },
  timeofusetime5: { address: 152, length: 1, type: 'UINT16', label: 'Time of Use Time 5', scale: 0, group: 'tou' },
  timeofusetime6: { address: 153, length: 1, type: 'UINT16', label: 'Time of Use Time 6', scale: 0, group: 'tou' },
  timeofusepower1: { address: 154, length: 1, type: 'UINT16', label: 'Time of Use Power 1', scale: 0, group: 'tou' },
  timeofusepower2: { address: 155, length: 1, type: 'UINT16', label: 'Time of Use Power 2', scale: 0, group: 'tou' },
  timeofusepower3: { address: 156, length: 1, type: 'UINT16', label: 'Time of Use Power 3', scale: 0, group: 'tou' },
  timeofusepower4: { address: 157, length: 1, type: 'UINT16', label: 'Time of Use Power 4', scale: 0, group: 'tou' },
  timeofusepower5: { address: 158, length: 1, type: 'UINT16', label: 'Time of Use Power 5', scale: 0, group: 'tou' },
  timeofusepower6: { address: 159, length: 1, type: 'UINT16', label: 'Time of Use Power 6', scale: 0, group: 'tou' },
  timeofusevoltage1: { address: 160, length: 1, type: 'UINT16', label: 'Time of Use Voltage 1', scale: -2, group: 'tou' },
  timeofusevoltage2: { address: 161, length: 1, type: 'UINT16', label: 'Time of Use Voltage 2', scale: -2, group: 'tou' },
  timeofusevoltage3: { address: 162, length: 1, type: 'UINT16', label: 'Time of Use Voltage 3', scale: -2, group: 'tou' },
  timeofusevoltage4: { address: 163, length: 1, type: 'UINT16', label: 'Time of Use Voltage 4', scale: -2, group: 'tou' },
  timeofusevoltage5: { address: 164, length: 1, type: 'UINT16', label: 'Time of Use Voltage 5', scale: -2, group: 'tou' },
  timeofusevoltage6: { address: 165, length: 1, type: 'UINT16', label: 'Time of Use Voltage 6', scale: -2, group: 'tou' },
  timeofusesoc1: { address: 166, length: 1, type: 'UINT16', label: 'Time of Use SOC 1', scale: 0, group: 'tou' },
  timeofusesoc2: { address: 167, length: 1, type: 'UINT16', label: 'Time of Use SOC 2', scale: 0, group: 'tou' },
  timeofusesoc3: { address: 168, length: 1, type: 'UINT16', label: 'Time of Use SOC 3', scale: 0, group: 'tou' },
  timeofusesoc4: { address: 169, length: 1, type: 'UINT16', label: 'Time of Use SOC 4', scale: 0, group: 'tou' },
  timeofusesoc5: { address: 170, length: 1, type: 'UINT16', label: 'Time of Use SOC 5', scale: 0, group: 'tou' },
  timeofusesoc6: { address: 171, length: 1, type: 'UINT16', label: 'Time of Use SOC 6', scale: 0, group: 'tou' },
  timeofusechargeenable1: { address: 172, length: 1, type: 'UINT16', label: 'Time of Use Charge Enable 1', scale: 0, group: 'tou' },
  timeofusechargeenable2: { address: 173, length: 1, type: 'UINT16', label: 'Time of Use Charge Enable 2', scale: 0, group: 'tou' },
  timeofusechargeenable3: { address: 174, length: 1, type: 'UINT16', label: 'Time of Use Charge Enable 3', scale: 0, group: 'tou' },
  timeofusechargeenable4: { address: 175, length: 1, type: 'UINT16', label: 'Time of Use Charge Enable 4', scale: 0, group: 'tou' },
  timeofusechargeenable5: { address: 176, length: 1, type: 'UINT16', label: 'Time of Use Charge Enable 5', scale: 0, group: 'tou' },
  timeofusechargeenable6: { address: 177, length: 1, type: 'UINT16', label: 'Time of Use Charge Enable 6', scale: 0, group: 'tou' },
  asymetricphasefeeding: { address: 237, length: 1, type: 'UINT16', label: 'Asymetric Phase Feeding', scale: 0, group: 'misc' },
  zeroexportpower: { address: 104, length: 1, type: 'INT16', label: 'Zero Export Power (raw, unit unverified)', scale: 0, group: 'misc' },
  energypattern: { address: 141, length: 1, type: 'UINT16', label: 'Energy Pattern (bit0: 1 = load first)', scale: 0, group: 'misc' },
  workmode: { address: 142, length: 1, type: 'UINT16', label: 'Work Mode (0 sell, 1 zero export load, 2 zero export CT)', scale: 0, group: 'misc' },
  maxsellpower: { address: 143, length: 1, type: 'UINT16', label: 'Max Sell Power', scale: 0, group: 'misc' },
  solarsell: { address: 145, length: 1, type: 'UINT16', label: 'Solar Selling', scale: 0, group: 'misc' },
  // Grid / generator charge: the global switches that apply while Time of Use is disabled (with Time of Use enabled the per-slot flags 172..177 apply)
  generatorchargeenable: { address: 129, length: 1, type: 'UINT16', label: 'Generator Charge Enable (Time of Use disabled)', scale: 0, group: 'misc' },
  gridchargeenable: { address: 130, length: 1, type: 'UINT16', label: 'Grid Charge Enable (Time of Use disabled)', scale: 0, group: 'misc' },
  // Battery capacity limits in percent
  batteryshutdowncapacity: { address: 115, length: 1, type: 'UINT16', label: 'Battery Capacity ShutDown (%)', scale: 0, group: 'misc' },
  batteryrestartcapacity: { address: 116, length: 1, type: 'UINT16', label: 'Battery Capacity Restart (%)', scale: 0, group: 'misc' },
  batterylowcapacity: { address: 117, length: 1, type: 'UINT16', label: 'Battery Capacity LowBatt (%)', scale: 0, group: 'misc' },
  gridpeakshavingmode: { address: 178, length: 1, type: 'UINT16', label: 'Peak shaving flags (bits 4-5 grid: 3 on, 2 off)', scale: 0, group: 'misc' },
  gridpeakshavingpower: { address: 191, length: 1, type: 'UINT16', label: 'Grid Peak Shaving Power', scale: 0, group: 'misc' },
  maxsolarpower: { address: 340, length: 1, type: 'UINT16', label: 'Max Solar Power', scale: 0, group: 'misc' },
};

// ---------------------------------------------------------------------------
// Register sets per communication protocol version
// ---------------------------------------------------------------------------

/** Register 2 holds the communication protocol version: high byte major, low byte minor. */
export const PROTOCOL_REGISTER = 2;

export interface RegisterSet {
  protocol: number;                       // value of register 2, e.g. 0x0104
  name: string;                           // 'v1.04'
  /**
   * Whether the write logic in controls.ts (addresses via keys, bit layouts of
   * the time-of-use flags, peak shaving and so on) is confirmed on this version.
   * Flow cards refuse to write when this is false.
   */
  writesVerified: boolean;
  registers: Record<string, RegisterDef>;
}

export function formatProtocol(protocol: number): string {
  return `v${protocol >> 8}.${String(protocol & 0xff).padStart(2, '0')}`;
}

export const protocolHex = (protocol: number) => '0x' + protocol.toString(16).padStart(4, '0');

/** Build a set from another one: add / change / remove registers by key. */
export function deriveSet(
  base: RegisterSet,
  o: {
    protocol: number;
    writesVerified?: boolean;
    add?: Record<string, RegisterDef>;
    change?: Record<string, Partial<RegisterDef>>;
    remove?: string[];
  },
): RegisterSet {
  const registers: Record<string, RegisterDef> = { ...base.registers, ...(o.add ?? {}) };
  for (const [key, patch] of Object.entries(o.change ?? {})) {
    if (!registers[key]) throw new Error(`deriveSet: unknown register "${key}"`);
    registers[key] = { ...registers[key], ...patch };
  }
  for (const key of o.remove ?? []) delete registers[key];
  return { protocol: o.protocol, name: formatProtocol(o.protocol), writesVerified: o.writesVerified ?? false, registers };
}

export const V104: RegisterSet = {
  protocol: 0x0104,
  name: 'v1.04',
  writesVerified: true,
  registers: V104_REGISTERS,
};

/** Every known protocol version. Add new versions here. */
export const REGISTER_SETS: RegisterSet[] = [V104];

export const findRegisterSet = (protocol: number): RegisterSet | null =>
  REGISTER_SETS.find((s) => s.protocol === protocol) ?? null;

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

export function decode(def: RegisterDef, words: number[]): string {
  switch (def.type) {
    case 'UINT16':
      return String(words[0]);
    case 'INT16':
      return String(words[0] > 0x7fff ? words[0] - 0x10000 : words[0]);
    case 'UINT32':
      // Deye sends the low word first
      return String(words[1] * 0x10000 + words[0]);
    case 'STRING':
      return decodeString(words);
    case 'HEX':
      return words.map((w) => w.toString(16).padStart(4, '0')).join('');
    default:
      throw new Error(`unknown register type ${def.type}`);
  }
}

export function decodeString(words: number[]): string {
  return words
    .map((w) => String.fromCharCode(w >> 8, w & 0xff))
    .join('')
    .replace(/\0/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Block planning: merge nearby registers into as few read requests as possible
// ---------------------------------------------------------------------------

// Most Modbus gateways accept up to 125 registers per request. Stay below that.
const MAX_BLOCK_SPAN = 100;
// Reading a few unused registers in a gap is cheaper than an extra request.
const MAX_BLOCK_GAP = 40;

export interface ReadBlock {
  start: number;
  length: number;
  keys: string[];
}

export function planBlocks(
  registers: Record<string, RegisterDef>,
  avoid: number[] = [],                 // addresses a block must not cover (known to be rejected)
  maxSpan = MAX_BLOCK_SPAN,
  maxGap = MAX_BLOCK_GAP,
): ReadBlock[] {
  const sorted = Object.entries(registers).sort((a, b) => a[1].address - b[1].address);
  const blocks: ReadBlock[] = [];
  let cur: ReadBlock | null = null;

  for (const [key, def] of sorted) {
    const end = def.address + def.length;           // exclusive
    if (cur) {
      const curEnd = cur.start + cur.length;
      const coversAvoided = avoid.some((a) => a >= curEnd && a < def.address);
      if (def.address - curEnd <= maxGap && end - cur.start <= maxSpan && !coversAvoided) {
        cur.length = Math.max(curEnd, end) - cur.start;
        cur.keys.push(key);
        continue;
      }
    }
    cur = { start: def.address, length: def.length, keys: [key] };
    blocks.push(cur);
  }
  return blocks;
}

// Plans are cached per register set and per set of rejected registers, so a block that
// would span a rejected address is split around it instead of failing every poll.
const planCache = new Map<string, ReadBlock[]>();
function blocksFor(set: RegisterSet, unsupported: Set<string>): ReadBlock[] {
  const signature = `${set.protocol}|${[...unsupported].sort().join(',')}`;
  let blocks = planCache.get(signature);
  if (!blocks) {
    const usable = Object.fromEntries(Object.entries(set.registers).filter(([k]) => !unsupported.has(k)));
    const avoid = [...unsupported].flatMap((k) =>
      set.registers[k] ? Array.from({ length: set.registers[k].length }, (_, i) => set.registers[k].address + i) : []);
    blocks = planBlocks(usable, avoid);
    planCache.set(signature, blocks);
  }
  return blocks;
}

/** The read blocks of a set (for tests and logging). */
export const readBlocks = (set: RegisterSet): ReadBlock[] => blocksFor(set, new Set());

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

type ModbusClient = InstanceType<typeof Modbus.client.TCP>;

// jsmodbus rejects with { err: 'ModbusException' | 'Timeout' | 'Offline' | ... }
const isModbusException = (e: any) => e?.err === 'ModbusException';

export interface Identity {
  protocol: number;
  serial: string;
}

/**
 * Registers 2..7 in one request: the communication protocol version (2) and the
 * serial number (3..7). These addresses are the same on every protocol version,
 * which is what makes it possible to pick the right register set.
 */
export async function readIdentity(client: ModbusClient): Promise<Identity> {
  const res = await client.readHoldingRegisters(PROTOCOL_REGISTER, 6);
  const words = res.response.body.valuesAsArray as number[];
  return { protocol: words[0], serial: decodeString(words.slice(1, 6)) };
}

/**
 * Read every register of `set` once and return a Snapshot.
 *
 * - One request per block (a handful in total).
 * - If a block is rejected with a Modbus exception (an unsupported address
 *   inside it), its registers are read one by one, and the ones that fail are
 *   added to `unsupported` so later polls skip them.
 * - Timeouts and connection errors are thrown: the caller decides about
 *   reconnecting. They are never retried per register (that would multiply
 *   the timeout).
 */
export async function readAllRegisters(
  client: ModbusClient,
  set: RegisterSet,
  unsupported: Set<string> = new Set(),
): Promise<Snapshot> {
  const result: Snapshot = {};
  const put = (key: string, words: number[]) => {
    const def = set.registers[key];
    result[key] = { value: decode(def, words), scale: def.scale, label: def.label, group: def.group };
  };

  for (const block of blocksFor(set, unsupported)) {
    const keys = block.keys.filter((k) => !unsupported.has(k));
    if (keys.length === 0) continue;

    try {
      const res = await client.readHoldingRegisters(block.start, block.length);
      const words = res.response.body.valuesAsArray as number[];
      for (const key of keys) {
        const def = set.registers[key];
        const offset = def.address - block.start;
        put(key, words.slice(offset, offset + def.length));
      }
    } catch (e) {
      if (!isModbusException(e)) throw e;
      for (const key of keys) {
        const def = set.registers[key];
        try {
          const res = await client.readHoldingRegisters(def.address, def.length);
          put(key, res.response.body.valuesAsArray as number[]);
        } catch (e2) {
          if (!isModbusException(e2)) throw e2;
          unsupported.add(key);
        }
      }
    }
  }
  return result;
}
