import type { Measurement, Snapshot } from './registers';

// ---------------------------------------------------------------------------
// Deye model detection from the identification registers (0-34), see the
// 'info' group in registers.ts and the Deye "MODBUS RTU three-phase energy
// storage" protocol V1.04, section 5.1.
//
// The inverter device already reads these registers in its normal poll, so
// this module only turns the Snapshot into a model string such as
// "SUN-12K-SG04LP3-EU". It does no Modbus I/O.
// ---------------------------------------------------------------------------

export type DeviceFamily =
  | 'string'
  | 'single-phase-hybrid'
  | 'micro'
  | 'three-phase-lv-hybrid'
  | 'three-phase-hv-hybrid'
  | 'unknown';

export interface InverterIdentification {
  /** Raw value of register 0. */
  deviceType: number;
  family: DeviceFamily;
  /** For example "1.04"; null when register 2 was not read. */
  protocolVersion: string | null;
  /** Rated power in watts, or null when the registers are not populated. */
  ratedPowerW: number | null;
  /** Raw value of register 28. */
  generation: number;
  /** For example "SUN-12K-SG04LP3-EU". */
  modelString: string;
  /** Caveats about how the model string was derived. */
  notes: string[];
}

/** Values of the identification registers; null = not read or not valid. */
export interface IdentificationFields {
  deviceType: number;
  generation: number;
  protocolVersionWord: number | null;
  /** Rated power registers 20/21 as one number, in units of 0.1 W. */
  ratedPowerRaw: number | null;
  market: number | null;
}

/**
 * Register 0. V1.04 defines 0x0005 and 0x0006 for the three-phase hybrids, later
 * documents use 0x0500 and 0x0600 (and 0x0601 for HV 20-50 kW), so both forms are accepted.
 */
export function classifyDeviceType(value: number): DeviceFamily {
  switch (value) {
    case 0x0200:
    case 0x0002:
      return 'string';
    case 0x0300:
    case 0x0003:
      return 'single-phase-hybrid';
    case 0x0400:
    case 0x0004:
      return 'micro';
    case 0x0005:
    case 0x0500:
      return 'three-phase-lv-hybrid';
    case 0x0006:
    case 0x0600:
    case 0x0601:
      return 'three-phase-hv-hybrid';
    default:
      return 'unknown';
  }
}

const FAMILY_SUFFIX: Record<DeviceFamily, string | null> = {
  string: null,
  'single-phase-hybrid': 'LP1',
  micro: null,
  'three-phase-lv-hybrid': 'LP3',
  'three-phase-hv-hybrid': 'HP3',
  unknown: null,
};

// Register 26: 0 = EU, 1 = US in V1.04; later documents add 2 = JP.
const MARKETS: Record<number, string> = { 0: 'EU', 1: 'US', 2: 'JP' };

function hex4(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

function protocolVersionText(word: number): string {
  return `${(word >> 8) & 0xff}.${String(word & 0xff).padStart(2, '0')}`;
}

/** Combine the decoded identification values into a model string and details. */
export function buildIdentification(f: IdentificationFields): InverterIdentification {
  const notes: string[] = [];
  const family = classifyDeviceType(f.deviceType);
  const suffix = FAMILY_SUFFIX[family];
  const generationLabel =
    f.generation >= 1 && f.generation <= 10 ? `SG${String(f.generation).padStart(2, '0')}` : null;
  const ratedPowerW =
    f.ratedPowerRaw !== null && f.ratedPowerRaw > 0 && f.ratedPowerRaw !== 0xffffffff
      ? f.ratedPowerRaw / 10
      : null;

  let modelString: string;
  if (suffix === null || generationLabel === null) {
    modelString = `Deye inverter (device type ${hex4(f.deviceType)}, generation ${f.generation})`;
    notes.push('Model could not be derived from the identification registers.');
  } else {
    const parts: string[] = ['SUN'];
    if (ratedPowerW !== null) {
      const kw = Math.round(ratedPowerW / 100) / 10; // one decimal
      parts.push(`${Number.isInteger(kw) ? kw : kw.toFixed(1)}K`);
      notes.push(
        'Power class comes from the rated power registers (20/21); some firmware reports the same value for every model in the series.',
      );
    }
    parts.push(`${generationLabel}${suffix}`);
    const marketLabel = f.market !== null ? MARKETS[f.market] : undefined;
    if (marketLabel) parts.push(marketLabel);
    modelString = parts.join('-');

    if (f.generation > 2) {
      notes.push(
        `Protocol V1.04 only defines generation 1 (SG01) and 2 (SG02); generation ${f.generation} is read as ${generationLabel}.`,
      );
    }
  }

  return {
    deviceType: f.deviceType,
    family,
    protocolVersion: f.protocolVersionWord !== null ? protocolVersionText(f.protocolVersionWord) : null,
    ratedPowerW,
    generation: f.generation,
    modelString,
    notes,
  };
}

// --- Snapshot adapter -------------------------------------------------------

const usable = (m: Measurement | undefined): m is Measurement =>
  !!m && m.value !== '';

/** Decimal register value (UINT16 / UINT32 raw), or null. */
function decimal(m: Measurement | undefined): number | null {
  if (!usable(m)) return null;
  const n = Number(m.value);
  return Number.isFinite(n) ? n : null;
}

/** HEX register value (decode() gives e.g. "0104"), or null. */
function hexWord(m: Measurement | undefined): number | null {
  if (!usable(m)) return null;
  const n = parseInt(m.value, 16);
  return Number.isFinite(n) ? n : null;
}

/**
 * Derive the model from a Snapshot. Returns null when the device type or the
 * generation register is missing (for example when the inverter rejected them).
 */
export function modelFromSnapshot(snapshot: Snapshot): InverterIdentification | null {
  const deviceType = hexWord(snapshot['devicetype']);
  const generation = decimal(snapshot['generation']);
  if (deviceType === null || generation === null) return null;

  return buildIdentification({
    deviceType,
    generation,
    protocolVersionWord: hexWord(snapshot['protocolversion']),
    ratedPowerRaw: decimal(snapshot['ratedpower']),
    market: decimal(snapshot['localization']),
  });
}
