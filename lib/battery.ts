import Homey from 'homey';
import type { Measurement, Snapshot } from './registers';

export type BatteryMeasurement = Measurement;

// Plausibility limits: ignore obviously corrupt readings
const MAX_BATTERY_POWER = 24150;      // W
const MAX_BATTERY_VOLTAGE = 60;       // V
const MIN_BATTERY_TEMP_RAW = 1000;    // Deye reports temperature as (raw - 1000) / 10 degrees C
const MAX_BATTERY_TEMP_RAW = 1500;

// Deye reports positive power/current when DISCHARGING. Homey's home-battery
// convention is positive = CHARGING, so these two values are inverted.
const HOMEY_SIGN = -1;

/** Every capability this device uses (titles/options are defined in driver.compose.json). */
export const BATTERY_CAPABILITIES = [
  'measure_power',
  'measure_battery',
  'measure_voltage.batteryvoltage',
  'measure_current.batterycurrent',
  'measure_temperature.batterytemperature',
  'meter_power.batterytodaycharge',
  'meter_power.batterytodaydischarge',
  'meter_power.batterytotalcharge',
  'meter_power.batterytotaldischarge',
];

/** Register groups in the inverter snapshot that this device consumes. */
const BATTERY_GROUPS: string[] = ['battery', 'batterysettings'];
const SERIAL_KEY = 'serial';             // group 'info', shown in the settings

// register key -> device setting (read-only labels from the BMS)
const SETTINGS_MAP: Record<string, string> = {
  batterysettingschargevoltage: 'maxchargevoltage',
  batterysettingschargecurrent: 'chargecurrent',
  batterysettingsdischargecurrent: 'dischargecurrent',
  batterysettingsmaxchargecurrent: 'maxchargecurrent',
  batterysettingsmaxdischargecurrent: 'maxdischargecurrent',
};

/**
 * Decodes the battery part of an inverter snapshot into capabilities and
 * settings. Contains no Modbus code: the inverter device does all the reading.
 */
export class DeyeBattery extends Homey.Device {

  /** Scaled numeric value for a snapshot key, or null when it is not in the snapshot. */
  protected num(result: Snapshot, key: string): number | null {
    const m = result[key];
    if (!m || m.value === 'xxx') return null;
    return Number(m.value) * Math.pow(10, Number(m.scale));
  }

  private async setCap(capability: string, value: number | null) {
    if (value === null || !Number.isFinite(value)) return;
    if (!this.hasCapability(capability)) await this.addCapability(capability).catch(this.error);
    await this.setCapabilityValue(capability, value).catch(this.error);
  }

  private async setSettingIfChanged(key: string, value: string) {
    if (this.getSetting(key) !== value) await this.setSettings({ [key]: value }).catch(this.error);
  }

  async processBatteryResult(snapshot: Snapshot) {
    if (!snapshot) return;

    // Only the register groups of the battery are of interest (plus the inverter serial for the settings)
    const result: Snapshot = {};
    for (const [key, m] of Object.entries(snapshot)) {
      if (BATTERY_GROUPS.includes(m.group) || key === SERIAL_KEY) result[key] = m;
    }

    const power = this.num(result, 'batterypower');
    if (power !== null && Math.abs(power) < MAX_BATTERY_POWER) {
      await this.setCap('measure_power', HOMEY_SIGN * power);
    }

    const voltage = this.num(result, 'batteryvoltage');
    if (voltage !== null && voltage < MAX_BATTERY_VOLTAGE) {
      await this.setCap('measure_voltage.batteryvoltage', voltage);
    }

    const current = this.num(result, 'batterycurrent');
    await this.setCap('measure_current.batterycurrent', current === null ? null : HOMEY_SIGN * current);

    const soc = this.num(result, 'batterypercentage');
    if (soc !== null && soc >= 0 && soc <= 100) {
      await this.setCap('measure_battery', soc);
    }

    const tempRaw = this.num(result, 'batterytemperature');
    if (tempRaw !== null && tempRaw >= MIN_BATTERY_TEMP_RAW && tempRaw <= MAX_BATTERY_TEMP_RAW) {
      await this.setCap('measure_temperature.batterytemperature', (tempRaw - MIN_BATTERY_TEMP_RAW) / 10);
    }

    await this.setCap('meter_power.batterytodaycharge', this.num(result, 'batterytodaycharge'));
    await this.setCap('meter_power.batterytodaydischarge', this.num(result, 'batterytodaydischarge'));
    await this.setCap('meter_power.batterytotalcharge', this.num(result, 'batterytotalcharge'));
    await this.setCap('meter_power.batterytotaldischarge', this.num(result, 'batterytotaldischarge'));

    // Read-only information shown in the device settings. Written only when it changed.
    for (const [regKey, settingKey] of Object.entries(SETTINGS_MAP)) {
      const v = this.num(result, regKey);
      if (v !== null) await this.setSettingIfChanged(settingKey, String(v));
    }
    const serial = result[SERIAL_KEY];
    if (serial && serial.value !== 'xxx') await this.setSettingIfChanged('serial', serial.value);
  }
}
