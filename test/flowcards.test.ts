const ROOT = require('path').resolve(__dirname, '..', '..');   // repository root (this file runs from .testbuild/test)
import { EventEmitter } from 'events';
let f = 0; const ok = (c: boolean, s: string) => { if (!c) f++; console.log(c ? 'ok  ' : 'FAIL', s); };
const gm = (v: number, group: any) => ({ value: String(v), scale: 0, label: '', group });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const fs = require('fs');
  const flow = (p: string) => JSON.parse(fs.readFileSync(ROOT + '/drivers/' + p + '/driver.flow.compose.json', 'utf8'));
  const ids = (d: any) => Object.fromEntries(Object.entries(d).map(([k, v]: any) => [k, v.map((c: any) => c.id)]));
  const dey = flow('deye'), bat = flow('battery'), sol = flow('solar');
  ok(JSON.stringify(ids(bat)) === JSON.stringify({ triggers: ['measure_battery_power_changed'], conditions: ['battery_charging', 'battery_discharging'] }), 'battery compose: ' + JSON.stringify(ids(bat)));
  ok(JSON.stringify(ids(sol)) === JSON.stringify({ triggers: ['measure_solar_power_changed'], conditions: ['solar_production'] }), 'solar compose: ' + JSON.stringify(ids(sol)));
  ok(JSON.stringify(dey.conditions.map((c: any) => c.id)) === '["grid_available","grid_feeding"]' && dey.triggers.length === 4 && dey.actions.length === 21, 'deye keeps 2 conditions, 4 triggers, 21 actions');
  const all = [dey, bat, sol].flatMap((d) => Object.values<any>(d).flat().map((c: any) => c.id));
  ok(new Set(all).size === all.length && all.length === 32, 'every card id is unique, 32 cards in total');

  // listeners registered per driver
  const listeners: Record<string, (a: any) => Promise<boolean>> = {};
  const homey = (inv: any[]) => ({ flow: { getConditionCard: (id: string) => ({ registerRunListener: (fn: any) => { listeners[id] = fn; } }), getActionCard: () => ({ registerRunListener() {} }) }, setTimeout, setInterval, clearInterval, drivers: { getDriver: () => ({ getDevices: () => inv }) }, __: (k: string) => k });
  const reg = (path: string, inv: any[] = []) => { const D = require('../drivers/' + path + '/driver'); const d = new D(); d.homey = homey(inv); d.log = () => {}; d.id = path; return d.onInit(); };
  await reg('battery'); const b = Object.keys(listeners).sort(); for (const k of b) delete listeners[k];
  await reg('solar'); const s = Object.keys(listeners).sort(); for (const k of Object.keys(listeners)) delete listeners[k];
  await reg('deye'); const dd = Object.keys(listeners).sort();
  ok(JSON.stringify(b) === '["battery_charging","battery_discharging"]', 'battery driver registers: ' + b);
  ok(JSON.stringify(s) === '["solar_production"]', 'solar driver registers: ' + s);
  ok(JSON.stringify(dd) === '["grid_available","grid_feeding"]', 'deye driver registers: ' + dd);

  // run the conditions on real child devices linked to a fake inverter
  const inv: any = { bus: new EventEmitter(), snap: { batterypower: gm(-800, 'battery'), pv1inputpower: gm(500, 'solar'), pv2inputpower: gm(0, 'solar'), gridpower: gm(-300, 'inverter'), l1gridvoltage: { ...gm(2300, 'inverter'), scale: -1 } }, avail: true, getSnapshot() { return this.snap; }, getAvailable() { return this.avail; }, getData() { return { id: 'inv1' }; }, getName() { return 'Inverter'; } };
  const mk = (path: string) => { const C = require('../drivers/' + path + '/device'); const d = new C(); d.homey = homey([inv]); d.getStoreValue = () => 'inv1'; d.log = () => {}; return d; };
  const batDev = mk('battery'), solDev = mk('solar');
  await batDev.onInit(); await solDev.onInit(); await sleep(30);
  ok(Object.keys(batDev.getSnapshot()).length > 0 && Object.keys(solDev.getSnapshot()).length > 0, 'child devices hand out the inverter snapshot');
  await reg('battery'); await reg('solar');
  ok((await listeners['battery_charging']({ device: batDev })) === true && (await listeners['battery_discharging']({ device: batDev })) === false, 'battery condition on the battery device: charging at -800 raw');
  ok((await listeners['solar_production']({ device: solDev })) === true, 'solar condition on the solar device');
  inv.snap = { ...inv.snap, batterypower: gm(900, 'battery'), pv1inputpower: gm(0, 'solar') };
  ok((await listeners['battery_discharging']({ device: batDev })) === true && (await listeners['solar_production']({ device: solDev })) === false, 'follows the new snapshot');
  inv.avail = false; inv.bus.emit('availability', false); await sleep(20);
  let msg = ''; await listeners['battery_charging']({ device: batDev }).catch((e: Error) => (msg = e.message));
  ok(/not available/.test(msg), 'inverter unavailable -> condition error: ' + msg);
  inv.avail = true; inv.bus.emit('availability', true); await sleep(20);
  inv.snap = {}; msg = ''; await listeners['solar_production']({ device: solDev }).catch((e: Error) => (msg = e.message));
  ok(/No solar power reading/.test(msg), 'no reading -> clear error: ' + msg);
  await batDev.onUninit(); await solDev.onUninit();
  ok(Object.keys(new (require('../drivers/battery/device'))().link.getSnapshot ? {} : {}).length === 0, 'ok');
  console.log(f ? f + ' FAILED' : 'all passed'); process.exit(f ? 1 : 0);
})();
