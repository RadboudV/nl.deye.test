import Homey from 'homey';
import type { Snapshot } from './registers';
import { ChangeTracker, fireTrigger } from './triggers';
import { measured } from './conditions';

// Plausibility limit: ignore obviously corrupt readings
const MAX_PV_POWER = 15600;           // W

/** Register group in the inverter snapshot that this device consumes. */
export const SOLAR_GROUP = 'solar';
const SERIAL_KEY = 'serial';             // group 'info', shown in the settings

/** snapshot key (register group 'solar') -> capability. Solar registers without an entry are ignored. */
const SOLAR_MAP: Record<string, string> = {
  pv1inputpower: 'measure_power.pv1inputpower',
  pv2inputpower: 'measure_power.pv2inputpower',
  pv1voltage: 'measure_voltage.pv1voltage',
  pv2voltage: 'measure_voltage.pv2voltage',
  pv1current: 'measure_current.pv1current',
  pv2current: 'measure_current.pv2current',
  dailysolarproduction: 'meter_power.dailysolarproduction',
  totalsolarproduction: 'meter_power.totalsolarproduction',
};
/** PV input power keys: plausibility-checked and summed into the total. */
const PV_POWER_KEYS = ['pv1inputpower', 'pv2inputpower'];

/** Every capability this device uses (titles/options are defined in driver.compose.json). */
export const SOLAR_CAPABILITIES = [
  'measure_power',                       // total PV power (sum of the PV inputs)
  ...Object.values(SOLAR_MAP),
  'meter_power',                         // total production, used by Homey Energy
];

/**
 * Decodes the solar part (register group 'solar') of an inverter snapshot into
 * capabilities. Contains no Modbus code: the inverter device does all the reading.
 */
export class DeyeSolar extends Homey.Device {

  private powerChanges = new ChangeTracker();   // flow trigger "Power from the solar cells changed"

  private async setCap(capability: string, value: number | null) {
    if (value === null || !Number.isFinite(value)) return;
    if (!this.hasCapability(capability)) await this.addCapability(capability).catch(this.error);
    await this.setCapabilityValue(capability, value).catch(this.error);
  }

  private async setSettingIfChanged(key: string, value: string) {
    if (this.getSetting(key) !== value) await this.setSettings({ [key]: value }).catch(this.error);
  }

  async processSolarResult(snapshot: Snapshot) {
    if (!snapshot) return;

    // Only the registers of group 'solar' are of interest (plus the inverter serial for the settings)
    const solar: Snapshot = {};
    for (const [key, m] of Object.entries(snapshot)) {
      if (m.group === SOLAR_GROUP) solar[key] = m;
    }

    const powers: number[] = [];
    let corrupt = false;           // an implausible PV input makes the total unreliable
    for (const [key, capability] of Object.entries(SOLAR_MAP)) {
      const value = measured(solar, key);
      if (value === null) continue;
      if (PV_POWER_KEYS.includes(key)) {
        if (value >= MAX_PV_POWER) { corrupt = true; continue; }
        powers.push(value);
      }
      await this.setCap(capability, value);
    }

    // Total = sum of the PV inputs that could be read (a missing input counts as unknown, not 0)
    if (powers.length > 0 && !corrupt) {
      const total = powers.reduce((a, b) => a + b, 0);
      if (total < MAX_PV_POWER) {
        await this.setCap('measure_power', total);
        if (this.powerChanges.changed('measure_solar_power_changed', total)) {
          await fireTrigger(this, 'measure_solar_power_changed', { measure_solar_power: total });
        }
      }
    }
    await this.setCap('meter_power', measured(solar, 'totalsolarproduction'));

    // Read-only information shown in the device settings. Written only when it changed.
    const serial = snapshot[SERIAL_KEY];
    if (serial) await this.setSettingIfChanged('serial', serial.value);
  }
}
