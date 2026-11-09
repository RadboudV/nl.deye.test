import Homey from 'homey';

import type { Measurement } from './registers';
import { OwnEnergyCounter } from './energycounter';

// The inverter device processes the inverter groups of the snapshot only.
// Battery values are handled by the battery device (lib/battery.ts).
export type DeyeMeasurement = Measurement;


// Plausibility limits: readings outside these are ignored
const MAX_PV_POWER = 15600;
const MAX_BATTERY_VOLTAGE = 60;

const MAX_GRIDPOWER_ABSOLUTE = 24150;
const MAX_BATTERY_TEMP_RAW = 1500;
const MIN_BATTERY_TEMP_RAW = 1000;

export class Deye extends Homey.Device {

    // Daily / total energy of the inverter's own power usage (integrated from measure_power.deyeownconsumption)
    private ownCounter?: OwnEnergyCounter;
    private ownCounterSaved = 0;

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

            // Show result
			// disabled logging 
//            for (let k in result) {
//                console.log(k, result[k].value, result[k].scale, result[k].label)
//				//this.debug(k, result[k].value, result[k].scale, result[k].label)
//            }

// Heat Sink Temperature
            if (result['heatsinktemperature'] && result['heatsinktemperature'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.heatsinktemperature')) {
					await this.addCapability('measure_temperature.heatsinktemperature').catch(this.error);
				}
                var heatsinktemperature = Number(result['heatsinktemperature'].value) * (Math.pow(10, Number(result['heatsinktemperature'].scale)));
                await this.setCapabilityValue('measure_temperature.heatsinktemperature', ((heatsinktemperature-1000)/10)).catch(this.error);
            }
// DC Transformer Temperature
/*
            if (result['dctransformertemperature'] && result['dctransformertemperature'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.dctransformertemperature')) {
					await this.addCapability('measure_temperature.dctransformertemperature').catch(this.error);
					await this.setCapabilityOptions('measure_temperature.dctransformertemperature', { "title": {
						"en": "DC Transformer Temperature",
						"nl": "DC transformator temperatuur"
						}, "uiComponent": null
						});
				}
                var dctransformertemperature = Number(result['dctransformertemperature'].value) * (Math.pow(10, Number(result['dctransformertemperature'].scale)));
                await await this.setCapabilityValue('measure_temperature.dctransformertemperature', ((dctransformertemperature-1000)/10));
            }
*/

//L1 Grid Voltage
            if (result['l1gridvoltage'] && result['l1gridvoltage'].value != 'xxx') {
				if (!this.hasCapability('measure_voltage.l1gridvoltage')) {
					await this.addCapability('measure_voltage.l1gridvoltage').catch(this.error);
					await this.setCapabilityOptions('measure_voltage.l1gridvoltage', { "title": {
						"en": "L1 Grid Voltage",
						"nl": "L1 Net Voltage"
						},
						"uiComponent": null
						});
				}
                var l1gridvoltage = Number(result['l1gridvoltage'].value) * (Math.pow(10, Number(result['l1gridvoltage'].scale)));
                await this.setCapabilityValue('measure_voltage.l1gridvoltage', l1gridvoltage).catch(this.error);
            }
//L2 Grid Voltage
            if (result['l2gridvoltage'] && result['l2gridvoltage'].value != 'xxx') {
				if (!this.hasCapability('measure_voltage.l2gridvoltage')) {
					await this.addCapability('measure_voltage.l2gridvoltage').catch(this.error);
					await this.setCapabilityOptions('measure_voltage.l2gridvoltage', { "title": {
						"en": "L2 Grid Voltage",
						"nl": "L2 Net Voltage"
						},
						"uiComponent": null
						});
				}
                var l2gridvoltage = Number(result['l2gridvoltage'].value) * (Math.pow(10, Number(result['l2gridvoltage'].scale)));
                await this.setCapabilityValue('measure_voltage.l2gridvoltage', l2gridvoltage).catch(this.error);
            }
//L3 Grid Voltage
            if (result['l3gridvoltage'] && result['l3gridvoltage'].value != 'xxx') {
				if (!this.hasCapability('measure_voltage.l3gridvoltage')) {
					await this.addCapability('measure_voltage.l3gridvoltage').catch(this.error);
					await this.setCapabilityOptions('measure_voltage.l3gridvoltage', { "title": {
						"en": "L3 Grid Voltage",
						"nl": "L3 Net Voltage"
						},
						"uiComponent": null
						});
				}
                var l3gridvoltage = Number(result['l3gridvoltage'].value) * (Math.pow(10, Number(result['l3gridvoltage'].scale)));
                await this.setCapabilityValue('measure_voltage.l3gridvoltage', l3gridvoltage).catch(this.error);
            }

//Inverter Frequency
            if (result['inverterfrequency'] && result['inverterfrequency'].value != 'xxx') {
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
                var inverterfrequency = Number(result['inverterfrequency'].value) * (Math.pow(10, Number(result['inverterfrequency'].scale)));
                await this.setCapabilityValue('measure_frequency.inverterfrequency', inverterfrequency).catch(this.error);
            }

//Load Frequency
            if (result['loadfrequency'] && result['loadfrequency'].value != 'xxx') {
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
                var loadfrequency = Number(result['loadfrequency'].value) * (Math.pow(10, Number(result['loadfrequency'].scale)));
                await this.setCapabilityValue('measure_frequency.loadfrequency', loadfrequency).catch(this.error);
            }

//Grid Frequency
            if (result['gridfrequency'] && result['gridfrequency'].value != 'xxx') {
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
                var gridfrequency = Number(result['gridfrequency'].value) * (Math.pow(10, Number(result['gridfrequency'].scale)));
                await this.setCapabilityValue('measure_frequency.gridfrequency', gridfrequency).catch(this.error);
            }


// **************
// ****** Battery
// **************
//Battery Power
            if (result['batterypower'] && result['batterypower'].value != 'xxx') {
				if (!this.hasCapability('measure_power.batterypower')) {
					await this.addCapability('measure_power.batterypower').catch(this.error);
					await this.setCapabilityOptions('measure_power.batterypower', { "title": {
						"en": "Battery Power",
						"nl": "Batterij vermogen"
						},
						});
				}
                var batterypower = Number(result['batterypower'].value) * (Math.pow(10, Number(result['batterypower'].scale)));

                if (batterypower < 24150 && batterypower > -24150) {
					await this.setCapabilityValue('measure_power.batterypower', batterypower).catch(this.error);
					}
            }
// Battery Voltage
            if (result['batteryvoltage'] && result['batteryvoltage'].value != 'xxx') {
				if (!this.hasCapability('measure_voltage.batteryvoltage')) {
					await this.addCapability('measure_voltage.batteryvoltage').catch(this.error);
					await this.setCapabilityOptions('measure_voltage.batteryvoltage', { "title": {
						"en": "Battery Voltage",
						"nl": "Batterij voltage"
						},
						});
				}
                var batteryvoltage = Number(result['batteryvoltage'].value) * (Math.pow(10, Number(result['batteryvoltage'].scale)));
				if (batteryvoltage < MAX_BATTERY_VOLTAGE) {
					await this.setCapabilityValue('measure_voltage.batteryvoltage', batteryvoltage).catch(this.error);
					}
            }
// Battery Current
            if (result['batterycurrent'] && result['batterycurrent'].value != 'xxx') {
				if (!this.hasCapability('measure_current.batterycurrent')) {
					await this.addCapability('measure_current.batterycurrent').catch(this.error);
				}
                var batterycurrent = Number(result['batterycurrent'].value) * (Math.pow(10, Number(result['batterycurrent'].scale)));
					await await this.setCapabilityValue('measure_current.batterycurrent', batterycurrent).catch(this.error);
            }
// Battery Percentage
            if (result['batterypercentage'] && result['batterypercentage'].value != 'xxx') {
				if (!this.hasCapability('measure_battery')) {
					await this.addCapability('measure_battery').catch(this.error);
				}
                var batterypercentage = Number(result['batterypercentage'].value) * (Math.pow(10, Number(result['batterypercentage'].scale)));
				if (batterypercentage > 0 && batterypercentage <= 100) {
					await this.setCapabilityValue('measure_battery', batterypercentage).catch(this.error);
					}
            }

// Battery Temperature
            if (result['batterytemperature'] && result['batterytemperature'].value != 'xxx') {
				if (!this.hasCapability('measure_temperature.batterytemperature')) {
					await this.addCapability('measure_temperature.batterytemperature').catch(this.error);
					await this.setCapabilityOptions('measure_temperature.batterytemperature', { "title": {
						"en": "Battery Temperature",
						"nl": "Accu temperatuur"
						},
						});
				}
                var batterytemperature = Number(result['batterytemperature'].value) * (Math.pow(10, Number(result['batterytemperature'].scale)));

				if (batterytemperature >= MIN_BATTERY_TEMP_RAW && batterytemperature <= MAX_BATTERY_TEMP_RAW) {
					await this.setCapabilityValue('measure_temperature.batterytemperature', ((batterytemperature-1000)/10)).catch(this.error);
					}
            }
// Today Battery Charge
            if (result['batterytodaycharge'] && result['batterytodaycharge'].value != 'xxx') {
				if (!this.hasCapability('meter_power.batterytodaycharge')) {
					await this.addCapability('meter_power.batterytodaycharge').catch(this.error);
					await this.setCapabilityOptions('meter_power.batterytodaycharge', { "title": {
						"en": "Today Battery Charge",
						"nl": "Vandaag vermogen geladen"
						},
						"duration": false
						});
				}
                var batterytodaycharge = Number(result['batterytodaycharge'].value) * (Math.pow(10, Number(result['batterytodaycharge'].scale)));
                await this.setCapabilityValue('meter_power.batterytodaycharge', batterytodaycharge).catch(this.error);
            }

// Total Battery Charge
            if (result['batterytotalcharge'] && result['batterytotalcharge'].value != 'xxx') {
				if (!this.hasCapability('meter_power.batterytotalcharge')) {
					await this.addCapability('meter_power.batterytotalcharge').catch(this.error);
					await this.setCapabilityOptions('meter_power.batterytotalcharge', { "title": {
						"en": "Total Battery Charge",
						"nl": "Totaal vermogen geladen"
						},
						"duration": false
						});
				}
                var batterytotalcharge = Number(result['batterytotalcharge'].value) * (Math.pow(10, Number(result['batterytotalcharge'].scale)));
                await this.setCapabilityValue('meter_power.batterytotalcharge', batterytotalcharge).catch(this.error);
            }

// Today Battery DISCharge
            if (result['batterytodaydischarge'] && result['batterytodaydischarge'].value != 'xxx') {
				if (!this.hasCapability('meter_power.batterytodaydischarge')) {
					await this.addCapability('meter_power.batterytodaydischarge').catch(this.error);
					await this.setCapabilityOptions('meter_power.batterytodaydischarge', { "title": {
						"en": "Today Battery Discharge",
						"nl": "Vandaag vermogen ontladen"
						},
						"duration": false
						});
				}
                var batterytodaydischarge = Number(result['batterytodaydischarge'].value) * (Math.pow(10, Number(result['batterytodaydischarge'].scale)));
                await this.setCapabilityValue('meter_power.batterytodaydischarge', batterytodaydischarge).catch(this.error);
            }

// Total Battery DISCharge
            if (result['batterytotaldischarge'] && result['batterytotaldischarge'].value != 'xxx') {
				if (!this.hasCapability('meter_power.batterytotaldischarge')) {
					await this.addCapability('meter_power.batterytotaldischarge').catch(this.error);
					await this.setCapabilityOptions('meter_power.batterytotaldischarge', { "title": {
						"en": "Total Battery Discharge",
						"nl": "Totaal vermogen ontladen"
						},
						"duration": false
						});
				}
                var batterytotaldischarge = Number(result['batterytotaldischarge'].value) * (Math.pow(10, Number(result['batterytotaldischarge'].scale)));
                await this.setCapabilityValue('meter_power.batterytotaldischarge', batterytotaldischarge).catch(this.error);
            }

// **************
// ****** Load
// **************
//Load (connection) Registers
//Load(home) Power
            if (result['loadtotalpower'] && result['loadtotalpower'].value != 'xxx') {
				if (!this.hasCapability('measure_power.loadtotalpower')) {
					await this.addCapability('measure_power.loadtotalpower').catch(this.error);
					await this.setCapabilityOptions('measure_power.loadtotalpower', { "title": {
						"en": "Homeload Power",
						"nl": "Huis vermogen"
						},
						});
				}
                var loadtotalpower = Number(result['loadtotalpower'].value) * (Math.pow(10, Number(result['loadtotalpower'].scale)));
                await this.setCapabilityValue('measure_power.loadtotalpower', loadtotalpower).catch(this.error);
            }
// Home load energy counters (register 526 daily, 527 total), exposed as "imported" energy of the device
            for (const [key, capability, en, nl] of [
                ['loaddailyconsumption', 'meter_power.dailyimported', 'Today Home Load Imported', 'Vandaag Huisverbruik'],
                ['loadtotalconsumption', 'meter_power.imported', 'Total Home Load Imported', 'Totaal Huisverbruik'],
            ]) {
                const m = result[key];
                if (!m || m.value == 'xxx') continue;
                if (!this.hasCapability(capability)) {
                    await this.addCapability(capability).catch(this.error);
                    await this.setCapabilityOptions(capability, { "title": { "en": en, "nl": nl }, "decimals": 2, "duration": false });
                }
                await this.setCapabilityValue(capability, Number(m.value) * Math.pow(10, Number(m.scale))).catch(this.error);
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
            if (result['gridpower'] && result['gridpower'].value != 'xxx') {
				if (!this.hasCapability('measure_power.gridpower')) {
					await this.addCapability('measure_power.gridpower').catch(this.error);
					await this.setCapabilityOptions('measure_power.gridpower', { "title": {
						"en": "Grid Power",
						"nl": "Net vermogen"
						},
						});
				}
                var gridpower = Number(result['gridpower'].value) * (Math.pow(10, Number(result['gridpower'].scale)));
				
				if (gridpower < MAX_GRIDPOWER_ABSOLUTE && gridpower > -MAX_GRIDPOWER_ABSOLUTE) {
					await this.setCapabilityValue('measure_power.gridpower', gridpower).catch(this.error);
					}
            }

// ********************************************************************************
// Calculated Deye Own Consumption
// ********************************************************************************


// Calculated Deye Own Consumption
            if (result['batterypower'] && result['batterypower'].value != 'xxx' && result['gridpower'] && result['gridpower'].value != 'xxx' && result['pv1inputpower'] && result['pv1inputpower'].value != 'xxx'  && result['pv2inputpower'] && result['pv2inputpower'].value != 'xxx'  && result['loadtotalpower'] && result['loadtotalpower'].value != 'xxx') {
				if (!this.hasCapability('measure_power.deyeownconsumption')) {
					await this.addCapability('measure_power.deyeownconsumption').catch(this.error);
					await this.setCapabilityOptions('measure_power.deyeownconsumption', { "title": {
						"en": "Deye Inverter own power usage",
						"nl": "Deye Inverter eigen verbruik"
						},
						});
				}
				if (Number(result['gridpower'].value) < 24150 && Number(result['gridpower'].value) > -24150 && Number(result['pv1inputpower'].value) < MAX_PV_POWER && Number(result['pv2inputpower'].value) < MAX_PV_POWER && Number(result['batterypower'].value) < 24150 && Number(result['batterypower'].value) > -24150) {
					var deyeownconsumption = Number(result['gridpower'].value) + Number(result['pv1inputpower'].value) + Number(result['pv2inputpower'].value) - (-Number(result['batterypower'].value)) - Number(result['loadtotalpower'].value)
					await this.setCapabilityValue('measure_power.deyeownconsumption', deyeownconsumption).catch(this.error);
					await this.setCapabilityValue('measure_power', deyeownconsumption).catch(this.error);
					await this.countOwnUsage(deyeownconsumption);
					}
            }

// ********************************************************************************
// Settings
// ********************************************************************************

// Read Settings and assing them a setting
/*Cooling Mode
            if (result['statuscooling'] && result['statuscooling'].value != 'xxx') {
//			var statuscooling = Number(result['statuscooling'].value);
			const statuscooling = Number(result['statuscooling'].value) === 1;
			const current = this.getSetting('settings_coolingmode');

			// var statuscooling = Boolean(result['statuscooling'].value);
			
			if (current !== statuscooling) {
				await this.setSettings({
				settings_coolingmode: statuscooling
			});
			}
            }
*/
   			if (result['batterysettingschargevoltage'] && result['batterysettingschargevoltage'].value != 'xxx') {
				const batterysettingschargevoltage = (Number(result['batterysettingschargevoltage'].value) * (Math.pow(10, Number(result['batterysettingschargevoltage'].scale)))).toString();
				const current = this.getSetting('maxchargevoltage');		
				if (current !== batterysettingschargevoltage) {
					await this.setSettings( {maxchargevoltage: batterysettingschargevoltage } ).catch(this.error);
				}
            }


   			if (result['batterysettingschargecurrent'] && result['batterysettingschargecurrent'].value != 'xxx') {
				const batterysettingschargecurrent = (Number(result['batterysettingschargecurrent'].value) * (Math.pow(10, Number(result['batterysettingschargecurrent'].scale)))).toString();
				const current = this.getSetting('chargecurrent');		
				if (current !== batterysettingschargecurrent) {
					await this.setSettings( {chargecurrent: batterysettingschargecurrent } ).catch(this.error);
				}
            }



//			if (result['batterysettingschargevoltage'] && result['batterysettingschargevoltage'].value != 'xxx') {
//				var batterysettingschargevoltage = (Number(result['batterysettingschargevoltage'].value) * (Math.pow(10, Number(result['batterysettingschargevoltage'].scale)))).toString();
//				await this.setSettings( {maxchargevoltage: batterysettingschargevoltage } ).catch(this.error);
//			}

//			if (result['batterysettingschargecurrent'] && result['batterysettingschargecurrent'].value != 'xxx') {
//				var batterysettingschargecurrent = (Number(result['batterysettingschargecurrent'].value) * (Math.pow(10, Number(result['batterysettingschargecurrent'].scale)))).toString();
//				await this.setSettings( {chargecurrent: batterysettingschargecurrent } ).catch(this.error);
//			}

			if (result['batterysettingsdischargecurrent'] && result['batterysettingsdischargecurrent'].value != 'xxx') {
				const batterysettingsdischargecurrent = (Number(result['batterysettingsdischargecurrent'].value) * (Math.pow(10, Number(result['batterysettingsdischargecurrent'].scale)))).toString();
				const current = this.getSetting('dischargecurrent');		
				if (current !== batterysettingsdischargecurrent) {
					await this.setSettings( {dischargecurrent: batterysettingsdischargecurrent } ).catch(this.error);
				}
			}

			if (result['batterysettingsmaxchargecurrent'] && result['batterysettingsmaxchargecurrent'].value != 'xxx') {
				const batterysettingsmaxchargecurrent = (Number(result['batterysettingsmaxchargecurrent'].value) * (Math.pow(10, Number(result['batterysettingsmaxchargecurrent'].scale)))).toString();
				const current = this.getSetting('maxchargecurrent');		
				if (current !== batterysettingsmaxchargecurrent) {
					await this.setSettings( {maxchargecurrent: batterysettingsmaxchargecurrent } ).catch(this.error);
				}
			}

			if (result['batterysettingsmaxdischargecurrent'] && result['batterysettingsmaxdischargecurrent'].value != 'xxx') {
				const batterysettingsmaxdischargecurrent = (Number(result['batterysettingsmaxdischargecurrent'].value) * (Math.pow(10, Number(result['batterysettingsmaxdischargecurrent'].scale)))).toString();
				const current = this.getSetting('maxdischargecurrent');		
				if (current !== batterysettingsmaxdischargecurrent) {
					await this.setSettings( {maxdischargecurrent: batterysettingsmaxdischargecurrent } ).catch(this.error);
				}
			}

// Settings: Asymetric Phase Feeding
			if (result['asymetricphasefeeding'] && result['asymetricphasefeeding'].value != 'xxx') {
				const asymetricphasefeeding = Number(result['asymetricphasefeeding'].value);
				const current = this.getSetting('settings_asymetricphasefeeding');		
				if (current !== asymetricphasefeeding) {
					await this.setSettings( {settings_asymetricphasefeeding: Boolean(asymetricphasefeeding)} ).catch(this.error);
				}
			}
			

			if (result['serial'] && result['serial'].value != 'xxx') {
				const serial = result['serial'].value;
				const current = this.getSetting('serial');		
				if (current !== serial) {
					await this.setSettings( {serial: serial } ).catch(this.error);
				}
			}

			if (result['ratedpower'] && result['ratedpower'].value != 'xxx') {
				const ratedpower = (Number(result['ratedpower'].value) * (Math.pow(10, Number(result['ratedpower'].scale)))).toString();
				const current = this.getSetting('ratedpower');		
				if (current !== ratedpower) {
					await this.setSettings( {ratedpower: ratedpower } ).catch(this.error);
				}
			}

			if (result['HMIversion1'] && result['HMIversion2'] && result['HMIversion1'].value != 'xxx' && result['HMIversion2'].value != 'xxx') {
				var HMIversion1 = result['HMIversion1'].value;
				var HMIversion2 = result['HMIversion2'].value;
				const HMIversion = HMIversion1 + '-' + HMIversion2;
				const current = this.getSetting('HMIversion');
				if (current !== HMIversion) {
					await this.setSettings( {HMIversion: HMIversion } ).catch(this.error);
				}
			}

			if (result['controlpanelversion1'] && result['controlpanelversion2'] && result['controlpanelversion1'].value != 'xxx' && result['controlpanelversion2'].value != 'xxx') {
				var controlpanelversion1 = result['controlpanelversion1'].value;
				var controlpanelversion2 = result['controlpanelversion2'].value;
				const controlpanelversion = controlpanelversion1 + '-' + controlpanelversion2;
				const current = this.getSetting('controlpanelversion');
				if (current !== controlpanelversion) {
					await this.setSettings( {controlpanelversion: controlpanelversion } ).catch(this.error);
				}
			}

//

        }
    }
}
