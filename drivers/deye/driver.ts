'use strict';

import Homey from 'homey';
import * as controls from '../../lib/controls';
import * as conditions from '../../lib/conditions';
import { Snapshot } from '../../lib/registers';

module.exports = class MyDeyeDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
	this.log('Deye Driver has been initialized:', this.id);
    // Flow cards are registered once per driver (not per device) and receive the chosen device as args.device.
    // Registering them inside Device.onInit would let the last device overwrite the listener of all others.
	this.registerActionCards();
	this.registerConditionCards();
  }

  /**
   * Flow condition cards. They evaluate the latest inverter snapshot, so they cost no
   * Modbus traffic. The inverted wording ("Battery not charging") is handled by Homey.
   */
  private registerConditionCards() {
    const condition = (id: string, what: string, test: (snap: Snapshot) => boolean | null) => {
      this.homey.flow.getConditionCard(id).registerRunListener(async (args: any) => {
        const device = args.device;
        if (!device.getAvailable()) throw new Error('The Deye inverter is not available right now');
        const result = test(device.getSnapshot());
        if (result === null) throw new Error(`No ${what} reading from the inverter yet`);
        return result;
      });
    };
    condition('grid_available', 'grid voltage', conditions.gridAvailable);
    condition('battery_charging', 'battery power', conditions.batteryCharging);
    condition('battery_discharging', 'battery power', conditions.batteryDischarging);
    condition('grid_feeding', 'grid power', conditions.gridFeeding);
    condition('solar_production', 'solar power', conditions.solarProducing);
  }

  /**
   * Flow action cards. Each card runs on the inverter device, which executes it
   * while it holds the Modbus connection (see device.control). Errors thrown
   * here are shown in the flow.
   */
  private registerActionCards() {
    const actioncard = (id: string, label: string, run: (args: any, io: controls.RegisterIO) => Promise<void>) => {
      this.homey.flow.getActionCard(id).registerRunListener(async (args: any) => {
        await args.device.control(label, (io: controls.RegisterIO) => run(args, io));
      });
    };

    // time of use timeslots
    actioncard('set_timeslot', 'Set timeslot', (a, io) => controls.setTimeslot(io, a.slot, a));
    actioncard('set_timeslot_time', 'Set timeslot start time', (a, io) => controls.setTimeslot(io, a.slot, { time: a.time }));
    actioncard('set_timeslot_power_soc', 'Set timeslot power and SOC', (a, io) =>
      controls.setTimeslot(io, a.slot, { power: a.power, soc: a.soc }));
    actioncard('set_timeslot_charge_options', 'Set timeslot charge options', (a, io) =>
      controls.setTimeslot(io, a.slot, { grid: a.grid, generator: a.generator, sell: a.sell }));
    actioncard('set_all_timeslots', 'Set all timeslots', (a, io) => controls.setAllTimeslots(io, a));
    actioncard('set_time_of_use_enabled', 'Set time of use', (a, io) => controls.setTimeOfUseEnabled(io, a.onoff));
    actioncard('set_time_of_use_day_enabled', 'Set time of use for weekday', (a, io) =>
      controls.setTimeOfUseDay(io, a.day, a.onoff));

    // other settings
    actioncard('set_solar_sell', 'Set solar selling', (a, io) => controls.setSolarSell(io, a.onoff));
    actioncard('set_work_mode', 'Set work mode', (a, io) =>
      controls.setWorkMode(io, String(a.workMode).toLowerCase(), a.zeroExportPower));
    actioncard('set_zero_export_power', 'Set zero export power', (a, io) => controls.setZeroExportPower(io, a.power));
    actioncard('set_energy_pattern', 'Set energy pattern', (a, io) =>
      controls.setEnergyPattern(io, a.energyPattern === 'LOAD_FIRST' ? 'load_first' : 'batt_first'));
    actioncard('set_grid_peak_shaving', 'Set grid peak shaving', (a, io) =>
      a.onoff === 'on' ? controls.setGridPeakShavingOn(io, a.power) : controls.setGridPeakShavingOff(io));
    actioncard('set_max_sell_power', 'Set max sell power', (a, io) => controls.setMaxSellPower(io, a.power));
    actioncard('set_max_solar_power', 'Set max solar power', (a, io) => controls.setMaxSolarPower(io, a.power));

    // advanced: raw write, only when enabled in the device settings
    this.homey.flow.getActionCard('write_register').registerRunListener(async (args: any) => {
      if (!args.device.getSetting('allow_raw_write')) {
        throw new Error("Raw register writes are disabled. Enable 'Allow the flow card Write value to register' in the device settings.");
      }
      await args.device.control('Write register', (io: controls.RegisterIO) =>
        controls.writeRawRegister(io, args.address, args.value));
    });
  }
};
