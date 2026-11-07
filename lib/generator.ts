import Homey from 'homey';
import type { Snapshot } from './registers';
import { measured } from './conditions';

/** Register group in the inverter snapshot that this device consumes. */
export const GENERATOR_GROUP = 'generator';
const SERIAL_KEY = 'serial';             // group 'info', shown in the settings

/** snapshot key (register group 'generator') -> capability. Registers without an entry are ignored. */
const GENERATOR_MAP: Record<string, string> = {
  generatortotalpower: 'measure_power',
  generatorl1power: 'measure_power.generatorl1power',
  generatorl2power: 'measure_power.generatorl2power',
  generatorl3power: 'measure_power.generatorl3power',
  generatorl1voltage: 'measure_voltage.generatorl1voltage',
  generatorl2voltage: 'measure_voltage.generatorl2voltage',
  generatorl3voltage: 'measure_voltage.generatorl3voltage',
  generatordailyproduction: 'meter_power.generatordailyproduction',
  generatorworkingtime: 'generatorworkingtime',
};

/** snapshot key (register group 'generator') -> read-only device setting (configured values, not measurements). */
const GENERATOR_SETTINGS: Record<string, string> = {
  generatorpeakshavingpower: 'peakshavingpower',
};

/** Every capability this device uses (titles/options are defined in driver.compose.json). */
export const GENERATOR_CAPABILITIES = Object.values(GENERATOR_MAP);

/**
 * Decodes the generator part (register group 'generator') of an inverter snapshot
 * into capabilities and settings. Contains no Modbus code: the inverter device
 * does all the reading.
 */
export class DeyeGenerator extends Homey.Device {

  private async setCap(capability: string, value: number | null) {
    if (value === null || !Number.isFinite(value)) return;
    if (!this.hasCapability(capability)) await this.addCapability(capability).catch(this.error);
    await this.setCapabilityValue(capability, value).catch(this.error);
  }

  private async setSettingIfChanged(key: string, value: string) {
    if (this.getSetting(key) !== value) await this.setSettings({ [key]: value }).catch(this.error);
  }

  async processGeneratorResult(snapshot: Snapshot) {
    if (!snapshot) return;

    // Only the registers of group 'generator' are of interest
    const generator: Snapshot = {};
    for (const [key, m] of Object.entries(snapshot)) {
      if (m.group === GENERATOR_GROUP) generator[key] = m;
    }

    for (const [key, capability] of Object.entries(GENERATOR_MAP)) {
      await this.setCap(capability, measured(generator, key));
    }
    for (const [key, setting] of Object.entries(GENERATOR_SETTINGS)) {
      const v = measured(generator, key);
      if (v !== null) await this.setSettingIfChanged(setting, String(v));
    }

    const serial = snapshot[SERIAL_KEY];
    if (serial && serial.value !== 'xxx') await this.setSettingIfChanged('serial', serial.value);
  }
}
