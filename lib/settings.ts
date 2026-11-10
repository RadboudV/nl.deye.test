import type { Snapshot } from './registers';
import * as controls from './controls';
import { RegisterIO, WRITE_GAP_MS } from './controls';

// ---------------------------------------------------------------------------
// The "Deye Settings" of the inverter device: each one mirrors a register of the inverter.
// - the poll copies the register value into the setting (settingsFromSnapshot)
// - changing the setting writes the register (applySettingChanges)
// No Homey or Modbus library code in here, so it can be tested on its own.
// ---------------------------------------------------------------------------

type Value = boolean | string | number | undefined | null;
type Settings = Record<string, Value>;

interface SettingDef {
  id: string;                                        // setting id in driver.settings.compose.json
  key: string;                                       // register key in the snapshot
  read(raw: number): boolean | string | number | undefined;
  write?(io: RegisterIO, value: Value): Promise<void>;     // missing: handled together with the grid shaving pair
}

const onOff = (v: Value) => (v ? 'on' : 'off');

const WORK_MODE_IDS = ['SELLING_FIRST', 'ZERO_EXPORT_TO_LOAD', 'ZERO_EXPORT_TO_CT'];

export const GRID_SHAVING_ENABLED = 'settings_energygridshavingenabled';
export const GRID_SHAVING_POWER = 'settings_energygridshavingpower';

const DEFS: SettingDef[] = [
  // Register 146 bit 0: time of use on/off
  { id: 'settings_timeofuseenabled', key: 'timeofuseweeklysellingschedule', read: (r) => (r & 0x01) === 0x01,
    write: (io, v) => controls.setTimeOfUseEnabled(io, onOff(v)) },
  // Register 145: global solar selling (applies while Time of Use is disabled)
  { id: 'settings_solarsellenabled', key: 'solarsell', read: (r) => r !== 0,
    write: (io, v) => controls.setSolarSell(io, onOff(v)) },
  // Registers 130 / 129: grid and generator charge (apply while Time of Use is disabled)
  { id: 'settings_energygridchargeenabled', key: 'gridchargeenable', read: (r) => r !== 0,
    write: (io, v) => controls.setGridChargeEnabled(io, onOff(v)) },
  { id: 'settings_energygenchargeenabled', key: 'generatorchargeenable', read: (r) => r !== 0,
    write: (io, v) => controls.setGeneratorChargeEnabled(io, onOff(v)) },
  // Register 142: work mode
  { id: 'settings_workmode', key: 'workmode', read: (r) => WORK_MODE_IDS[r],
    write: (io, v) => controls.setWorkMode(io, String(v).toLowerCase()) },
  // Register 141 bit 0: energy pattern
  { id: 'settings_energypriority', key: 'energypattern', read: (r) => ((r & 0x01) === 0x01 ? 'LOAD_FIRST' : 'BATTERY_FIRST'),
    write: (io, v) => controls.setEnergyPattern(io, v === 'LOAD_FIRST' ? 'load_first' : 'batt_first') },
  // Register 178 bits 4-5 (3 = on) and 191 (power): grid peak shaving. Written together, see applySettingChanges.
  { id: GRID_SHAVING_ENABLED, key: 'gridpeakshavingmode', read: (r) => ((r >> 4) & 0x03) === 0x03 },
  { id: GRID_SHAVING_POWER, key: 'gridpeakshavingpower', read: (r) => r },
  // Register 190: generator peak shaving power
  { id: 'settings_energygeneratorpower', key: 'generatorpeakshavingpower', read: (r) => r,
    write: (io, v) => controls.setGeneratorPeakShavingPower(io, v) },
  // Register 143: maximum power to the grid
  { id: 'settings_maxoutputtogrid', key: 'maxsellpower', read: (r) => r,
    write: (io, v) => controls.setMaxSellPower(io, v) },
  // Register 237: asymetric phase feeding
  { id: 'settings_asymetricphasefeeding', key: 'asymetricphasefeeding', read: (r) => r !== 0,
    write: (io, v) => controls.setAsymetricPhaseFeeding(io, onOff(v)) },
];

/** Setting ids that are written to the inverter when the user changes them. */
export const CONTROL_SETTING_IDS = DEFS.map((d) => d.id);

/**
 * The settings whose value differs from the inverter's register value, as an object for
 * setSettings(). Registers that are not in the snapshot (or hold a value the setting cannot show) are left alone.
 */
export function settingsFromSnapshot(snapshot: Snapshot, current: Settings): Settings {
  const changes: Settings = {};
  for (const def of DEFS) {
    const m = snapshot[def.key];
    if (!m) continue;
    const raw = Number(m.value);
    if (!Number.isFinite(raw)) continue;
    const value = def.read(raw);
    if (value !== undefined && current[def.id] !== value) changes[def.id] = value;
  }
  return changes;
}

/** Writes the registers behind the changed settings. Throws a ControlError / Error when the inverter refuses. */
export async function applySettingChanges(io: RegisterIO, changedKeys: string[], settings: Settings): Promise<void> {
  const changed = new Set(changedKeys);
  let first = true;
  const gap = async () => { if (!first) await io.pause(WRITE_GAP_MS); first = false; };

  for (const def of DEFS) {
    if (!changed.has(def.id) || !def.write) continue;
    await gap();
    await def.write(io, settings[def.id]);
  }

  // Grid peak shaving: switching on needs the power, so the two settings are written together (power first)
  if (changed.has(GRID_SHAVING_ENABLED) || changed.has(GRID_SHAVING_POWER)) {
    const enabled = Boolean(settings[GRID_SHAVING_ENABLED]);
    const power = settings[GRID_SHAVING_POWER];
    await gap();
    if (enabled) {
      await controls.setGridPeakShavingOn(io, power);
    } else {
      if (changed.has(GRID_SHAVING_POWER)) { await controls.setGridPeakShavingPower(io, power); await gap(); }
      if (changed.has(GRID_SHAVING_ENABLED)) await controls.setGridPeakShavingOff(io);
    }
  }
}
