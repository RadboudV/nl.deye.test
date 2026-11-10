import Homey from 'homey';

import type { Measurement } from './registers';
import { OwnEnergyCounter } from './energycounter';
import { gridAvailable } from './conditions';
import { settingsFromSnapshot } from './settings';
import { ChangeTracker, StateDebouncer, fireTrigger } from './triggers';

// The inverter device processes the inverter groups of the snapshot only.
// Battery values are handled by the battery device (lib/battery.ts).
export type DeyeMeasurement = Measurement;


// Plausibility limits: readings outside these are ignored
const MAX_PV_POWER = 15600;
//const MAX_BATTERY_VOLTAGE = 60;

const MAX_GRIDPOWER_ABSOLUTE = 24150;
//const MAX_BATTERY_TEMP_RAW = 1500;
//const MIN_BATTERY_TEMP_RAW = 1000;

export class Deye extends Homey.Device {

    // Daily / total energy of the inverter's own power usage (integrated from measure_power.deyeownconsumption)
    private ownCounter?: OwnEnergyCounter;
    private ownCounterSaved = 0;

    // Flow triggers: "grid became (un)available" needs 2 polls to confirm, power triggers fire when the value changes
    private gridState = new StateDebouncer<boolean>();
    private powerChanges = new ChangeTracker();

    /** Forget a pending grid state change (called when a poll fails, the state is unknown then). */
    resetTriggerState() { this.gridState.reset(); }

    private async checkGridTrigger(result: Record<string, DeyeMeasurement>) {
        const change = this.gridState.update(gridAvailable(result));
        if (change) await fireTrigger(this, change.value ? 'grid_available_true' : 'grid_available_false');
    }

    private async firePowerChanged(card: string, token: string, watts: number) {
        if (this.powerChanges.changed(card, watts)) await fireTrigger(this, card, { [token]: watts });
    }

    /** Local date (Homey's timezone) as YYYY-MM-DD */
    private localDay(nowMs: number): string {
        const timeZone = this.homey.clock.getTimezone();
        return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
    }

    private async countOwnUsage(powerW: number) {
        if (!this.ownCounter) this.ownCounter = new OwnEnergyCounter(this.getStoreValue('ownUsageCounter'));
        const now = Date.now();
        const { daily, total, rolledOver } = this.ownCounter.update(powerW, now, this.localDay(now));

        const counters: [string, number, string, string][] = [
            ['meter_power.deyeowndailyconsumption', daily, 'Today Deye Inverter own usage', 'Vandaag Deye Inverter eigen verbruik'],
            ['meter_power.deyeowntotalconsumption', total, 'Total Deye Inverter own usage', 'Totaal Deye Inverter eigen verbruik'],
			['meter_power', total, 'Total Deye Inverter own usage', 'Totaal Deye Inverter eigen verbruik'],
        ];
        for (const [capability, value, en, nl] of counters) {
            if (!this.hasCapability(capability)) {
                await this.addCapability(capability).catch(this.error);
                await this.setCapabilityOptions(capability, { "title": { "en": en, "nl": nl }, "decimals": 2, "duration": false });
            }
            await this.setCapabilityValue(capability, Math.round(value * 1000) / 1000).catch(this.error);
        }

        // Persist at most every 5 minutes (and at midnight), so a restart loses at most a few minutes of data
        if (rolledOver || Date.now() - this.ownCounterSaved > 5 * 60 * 1000) await this.saveOwnUsage();
    }

    async saveOwnUsage() {
        if (!this.ownCounter) return;
        this.ownCounterSaved = Date.now();
        await this.setStoreValue('ownUsageCounter', this.ownCounter.state).catch(this.error);
    }

    async processDeyeResult(result: Record<string, DeyeMeasurement>) {

        if (result) {

            await this.checkGridTrigger(result);

// Heat Sink Temperature
            if (result['heatsinktemperature']) {
				if (!this.hasCapability('measure_temperature.heatsinktemperature')) {
					await this.addCapability('measure_temperature.heatsinktemperature').catch(this.error);
				}
                const heatsinktemperature = Number(result['heatsinktemperature'].value) * (Math.pow(10, Number(result['heatsinktemperature'].scale)));
                await this.setCapabilityValue('measure_temperature.heatsinktemperature', ((heatsinktemperature-1000)/10)).catch(this.error);
            }
// DC Transformer Temperature
/*
            if (result['dctransformertemperature']) {
				if (!this.hasCapability('measure_temperature.dctransformertemperature')) {
					await this.addCapability('measure_temperature.dctransformertemperature').catch(this.error);
					await this.setCapabilityOptions('measure_temperature.dctransformertemperature', { "title": {
						"en": "DC Transformer Temperature",
						"nl": "DC transformator temperatuur"
						}, "uiComponent": null
						});
				}
                const dctransformertemperature = Number(result['dctransformertemperature'].value) * (Math.pow(10, Number(result['dctransformertemperature'].scale)));
                await await this.setCapabilityValue('measure_temperature.dctransformertemperature', ((dctransformertemperature-1000)/10));
            }
*/

//L1 Grid Voltage
            if (result['l1gridvoltage']) {
				if (!this.hasCapability('measure_voltage.l1gridvoltage')) {
					await this.addCapability('measure_voltage.l1gridvoltage').catch(this.error);
					await this.setCapabilityOptions('measure_voltage.l1gridvoltage', { "title": {
						"en": "L1 Grid Voltage",
						"nl": "L1 Net Voltage"
						},
						"uiComponent": null
						});
				}
                const l1gridvoltage = Number(result['l1gridvoltage'].value) * (Math.pow(10, Number(result['l1gridvoltage'].scale)));
                await this.setCapabilityValue('measure_voltage.l1gridvoltage', l1gridvoltage).catch(this.error);
            }
//L2 Grid Voltage
            if (result['l2gridvoltage']) {
				if (!this.hasCapability('measure_voltage.l2gridvoltage')) {
					await this.addCapability('measure_voltage.l2gridvoltage').catch(this.error);
					await this.setCapabilityOptions('measure_voltage.l2gridvoltage', { "title": {
						"en": "L2 Grid Voltage",
						"nl": "L2 Net Voltage"
						},
						"uiComponent": null
						});
				}
                const l2gridvoltage = Number(result['l2gridvoltage'].value) * (Math.pow(10, Number(result['l2gridvoltage'].scale)));
                await this.setCapabilityValue('measure_voltage.l2gridvoltage', l2gridvoltage).catch(this.error);
            }
//L3 Grid Voltage
            if (result['l3gridvoltage']) {
				if (!this.hasCapability('measure_voltage.l3gridvoltage')) {
					await this.addCapability('measure_voltage.l3gridvoltage').catch(this.error);
					await this.setCapabilityOptions('measure_voltage.l3gridvoltage', { "title": {
						"en": "L3 Grid Voltage",
						"nl": "L3 Net Voltage"
						},
						"uiComponent": null
						});
				}
                const l3gridvoltage = Number(result['l3gridvoltage'].value) * (Math.pow(10, Number(result['l3gridvoltage'].scale)));
                await this.setCapabilityValue('measure_voltage.l3gridvoltage', l3gridvoltage).catch(this.error);
            }

//Inverter Frequency
            if (result['inverterfrequency']) {
				if (!this.hasCapability('measure_frequency.inverterfrequency')) {
					await this.addCapability('measure_frequency.inverterfrequency').catch(this.error);
					await this.setCapabilityOptions('measure_frequency.inverterfrequency', { "title": {
						"en": "Inverter Frequency",
						"nl": "Inverter frequentie"
						},
						"uiComponent": null,
						"decimals": 2
						});
				}
                const inverterfrequency = Number(result['inverterfrequency'].value) * (Math.pow(10, Number(result['inverterfrequency'].scale)));
                await this.setCapabilityValue('measure_frequency.inverterfrequency', inverterfrequency).catch(this.error);
            }

//Load Frequency
            if (result['loadfrequency']) {
				if (!this.hasCapability('measure_frequency.loadfrequency')) {
					await this.addCapability('measure_frequency.loadfrequency').catch(this.error);
					await this.setCapabilityOptions('measure_frequency.loadfrequency', { "title": {
						"en": "Load Frequency",
						"nl": "Load frequentie"
						},
						"uiComponent": null,
						"decimals": 2
						});
				}
                const loadfrequency = Number(result['loadfrequency'].value) * (Math.pow(10, Number(result['loadfrequency'].scale)));
                await this.setCapabilityValue('measure_frequency.loadfrequency', loadfrequency).catch(this.error);
            }

//Grid Frequency
            if (result['gridfrequency']) {
				if (!this.hasCapability('measure_frequency.gridfrequency')) {
					await this.addCapability('measure_frequency.gridfrequency').catch(this.error);
					await this.setCapabilityOptions('measure_frequency.gridfrequency', { "title": {
						"en": "Grid Frequency",
						"nl": "Grid frequentie"
						},
						"uiComponent": null,
						"decimals": 2
						});
				}
                const gridfrequency = Number(result['gridfrequency'].value) * (Math.pow(10, Number(result['gridfrequency'].scale)));
                await this.setCapabilityValue('measure_frequency.gridfrequency', gridfrequency).catch(this.error);
            }


// **************
// ****** Solar
// **************
//removed solar items, and moved them to solar device

// **************
// ****** Battery
// **************
//removed battery items, and moved them to battery device

// **************
// ****** Load
// **************
//Load (connection) Registers
//Load(home) Power
            if (result['loadtotalpower']) {
				if (!this.hasCapability('measure_power.loadtotalpower')) {
					await this.addCapability('measure_power.loadtotalpower').catch(this.error);
					await this.setCapabilityOptions('measure_power.loadtotalpower', { "title": {
						"en": "Homeload Power",
						"nl": "Huis vermogen"
						},
						});
				}
                const loadtotalpower = Number(result['loadtotalpower'].value) * (Math.pow(10, Number(result['loadtotalpower'].scale)));
                await this.setCapabilityValue('measure_power.loadtotalpower', loadtotalpower).catch(this.error);
                await this.firePowerChanged('measure_consumption_power_changed', 'measure_consumption_power', loadtotalpower);
            }

// Home load energy counters (register 526 daily, 527 total), exposed as "imported" energy of the device
            for (const [key, capability, en, nl] of [
                ['loaddailyconsumption', 'meter_power.dailyimported', 'Today Home Load Imported', 'Vandaag Huisverbruik'],
                ['loadtotalconsumption', 'meter_power.imported', 'Total Home Load Imported', 'Totaal Huisverbruik'],
            ]) {
                const readitem = result[key];
                if (!readitem) continue;
                if (!this.hasCapability(capability)) {
                    await this.addCapability(capability).catch(this.error);
                    await this.setCapabilityOptions(capability, { "title": { "en": en, "nl": nl }, "decimals": 2, "duration": false });
                }
                await this.setCapabilityValue(capability, Number(readitem.value) * Math.pow(10, Number(readitem.scale))).catch(this.error);
            }
// **************
// ****** Grid
// **************
//Grid Registers
/*
		"gridpower":[525, 1, 'INT16', "Total Grid Power", 0],
		"l1gridvoltage":[598, 1, 'UINT16', "L1 Grid Voltage", -1],
		"l2gridvoltage":[599, 1, 'UINT16', "L2 Grid Voltage", -1],
		"l3gridvoltage":[600, 1, 'UINT16', "L3 Grid Voltage", -1],
		"internalctl1power":[604, 1, 'INT16', "Internal CT L1 Power", 0],
		"internalctl2power":[605, 1, 'INT16', "Internal CT L2 Power", 0],
		"internalctl3power":[606, 1, 'INT16', "Internal CT L3 Power", 0],
		"externalctl1power":[616, 1, 'INT16', "External CT L1 Power", 0],
		"externalctl2power":[617, 1, 'INT16', "External CT L2 Power", 0],
		"externalctl3power":[618, 1, 'INT16', "External CT L3 Power", 0],
		"dailyenergybought":[520, 1, 'UINT16', "Daily Energy Bought", -1],
		"totalenergybought":[522, 2, 'UINT32', "Total Energy Bought", -1],
		"dailyenergysold":[521, 1, 'UINT16', "Daily Energy Sold", -1],
		"totalenergysold":[524, 2, 'UINT32', "Total Energy Sold", -1],
		"l1current":[630, 1, 'INT16', "L1 Current", -2],
		"l2current":[631, 1, 'INT16', "L2 Current", -2],
		"l3current":[632, 1, 'INT16', "L3 Current", -2],
		"l1inverterpower":[633, 1, 'INT16', "Inverter L1 Power", 0],
		"l2inverterpower":[634, 1, 'INT16', "Inverter L2 Power", 0],
		"l3inverterpower":[635, 1, 'INT16', "Inverter L3 Power", 0],
//		"dctransformertemperature":[540, 1, 'UINT16', "DC Transformer Temperature", 0],
		"heatsinktemperature":[541, 1, 'UINT16', "HeatSink Temperature", 0],
		"inverterfrequency":[638, 1, 'UINT16', "Inverter Frequency", -2],
		"loadfrequency":[655, 1, 'UINT16', "Load Frequency", -2],
		"gridfrequency":[609, 1, 'UINT16', "Grid Frequency", -2],
*/

//Grid Power
            if (result['gridpower']) {
				if (!this.hasCapability('measure_power.gridpower')) {
					await this.addCapability('measure_power.gridpower').catch(this.error);
					await this.setCapabilityOptions('measure_power.gridpower', { "title": {
						"en": "Grid Power",
						"nl": "Net vermogen"
						},
						});
				}
                const gridpower = Number(result['gridpower'].value) * (Math.pow(10, Number(result['gridpower'].scale)));
				
				if (gridpower < MAX_GRIDPOWER_ABSOLUTE && gridpower > -MAX_GRIDPOWER_ABSOLUTE) {
					await this.setCapabilityValue('measure_power.gridpower', gridpower).catch(this.error);
					await this.firePowerChanged('measure_grid_power_changed', 'measure_grid_power', gridpower);
					}
            }

// ********************************************************************************
// Calculated Deye Own Consumption
// ********************************************************************************
// Calculated Deye Own Consumption

            if (result['batterypower'] && result['gridpower'] && result['pv1inputpower']  && result['pv2inputpower']  && result['loadtotalpower']) {
				if (!this.hasCapability('measure_power.deyeownconsumption')) {
					await this.addCapability('measure_power.deyeownconsumption').catch(this.error);
					await this.setCapabilityOptions('measure_power.deyeownconsumption', { "title": {
						"en": "Deye Inverter own power usage",
						"nl": "Deye Inverter eigen verbruik"
						},
						});
				}
				if (Number(result['gridpower'].value) < 24150 && Number(result['gridpower'].value) > -24150 && Number(result['pv1inputpower'].value) < MAX_PV_POWER && Number(result['pv2inputpower'].value) < MAX_PV_POWER && Number(result['batterypower'].value) < 24150 && Number(result['batterypower'].value) > -24150) {
					const deyeownconsumption = Number(result['gridpower'].value) + Number(result['pv1inputpower'].value) + Number(result['pv2inputpower'].value) - (-Number(result['batterypower'].value)) - Number(result['loadtotalpower'].value)
					await this.setCapabilityValue('measure_power.deyeownconsumption', deyeownconsumption).catch(this.error);
					await this.setCapabilityValue('measure_power', deyeownconsumption).catch(this.error);
					await this.countOwnUsage(deyeownconsumption);
					}
            }

// ********************************************************************************
// Settings
// ********************************************************************************
// Read Settings and assing them a setting

   			if (result['batterysettingschargevoltage']) {
				const batterysettingschargevoltage = (Number(result['batterysettingschargevoltage'].value) * (Math.pow(10, Number(result['batterysettingschargevoltage'].scale)))).toString();
				const current = this.getSetting('maxchargevoltage');		
				if (current !== batterysettingschargevoltage) {
					await this.setSettings( {maxchargevoltage: batterysettingschargevoltage } ).catch(this.error);
				}
            }

   			if (result['batterysettingschargecurrent']) {
				const batterysettingschargecurrent = (Number(result['batterysettingschargecurrent'].value) * (Math.pow(10, Number(result['batterysettingschargecurrent'].scale)))).toString();
				const current = this.getSetting('chargecurrent');		
				if (current !== batterysettingschargecurrent) {
					await this.setSettings( {chargecurrent: batterysettingschargecurrent } ).catch(this.error);
				}
            }

			if (result['batterysettingsdischargecurrent']) {
				const batterysettingsdischargecurrent = (Number(result['batterysettingsdischargecurrent'].value) * (Math.pow(10, Number(result['batterysettingsdischargecurrent'].scale)))).toString();
				const current = this.getSetting('dischargecurrent');		
				if (current !== batterysettingsdischargecurrent) {
					await this.setSettings( {dischargecurrent: batterysettingsdischargecurrent } ).catch(this.error);
				}
			}

			if (result['batterysettingsmaxchargecurrent']) {
				const batterysettingsmaxchargecurrent = (Number(result['batterysettingsmaxchargecurrent'].value) * (Math.pow(10, Number(result['batterysettingsmaxchargecurrent'].scale)))).toString();
				const current = this.getSetting('maxchargecurrent');		
				if (current !== batterysettingsmaxchargecurrent) {
					await this.setSettings( {maxchargecurrent: batterysettingsmaxchargecurrent } ).catch(this.error);
				}
			}

			if (result['batterysettingsmaxdischargecurrent']) {
				const batterysettingsmaxdischargecurrent = (Number(result['batterysettingsmaxdischargecurrent'].value) * (Math.pow(10, Number(result['batterysettingsmaxdischargecurrent'].scale)))).toString();
				const current = this.getSetting('maxdischargecurrent');		
				if (current !== batterysettingsmaxdischargecurrent) {
					await this.setSettings( {maxdischargecurrent: batterysettingsmaxdischargecurrent } ).catch(this.error);
				}
			}

// Settings that mirror an inverter register (time of use, work mode, peak shaving, asymetric phase feeding ...)
			const settingChanges = settingsFromSnapshot(result, this.getSettings());
			if (Object.keys(settingChanges).length > 0) {
				await this.setSettings(settingChanges).catch(this.error);
			}

			if (result['serial']) {
				const serial = result['serial'].value;
				const current = this.getSetting('serial');		
				if (current !== serial) {
					await this.setSettings( {serial: serial } ).catch(this.error);
				}
			}

			if (result['ratedpower']) {
				const ratedpower = (Number(result['ratedpower'].value) * (Math.pow(10, Number(result['ratedpower'].scale)))).toString();
				const current = this.getSetting('ratedpower');		
				if (current !== ratedpower) {
					await this.setSettings( {ratedpower: ratedpower } ).catch(this.error);
				}
			}

			if (result['HMIversion1'] && result['HMIversion2']) {
				const HMIversion1 = result['HMIversion1'].value;
				const HMIversion2 = result['HMIversion2'].value;
				const HMIversion = HMIversion1 + '-' + HMIversion2;
				const current = this.getSetting('HMIversion');
				if (current !== HMIversion) {
					await this.setSettings( {HMIversion: HMIversion } ).catch(this.error);
				}
			}

			if (result['controlpanelversion1'] && result['controlpanelversion2']) {
				const controlpanelversion1 = result['controlpanelversion1'].value;
				const controlpanelversion2 = result['controlpanelversion2'].value;
				const controlpanelversion = controlpanelversion1 + '-' + controlpanelversion2;
				const current = this.getSetting('controlpanelversion');
				if (current !== controlpanelversion) {
					await this.setSettings( {controlpanelversion: controlpanelversion } ).catch(this.error);
				}
			}

        }
    }
}
