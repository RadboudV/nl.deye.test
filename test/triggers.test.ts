import { StateDebouncer, ChangeTracker } from '../lib/triggers';
let f = 0; const ok = (c: boolean, s: string) => { if (!c) f++; console.log(c ? 'ok  ' : 'FAIL', s); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // debouncer
  const d = new StateDebouncer<boolean>(2);
  ok(d.update(true) === null, 'first reading is stored, no trigger');
  ok(d.update(true) === null, 'same state: nothing');
  ok(d.update(false) === null, 'one poll of a new state: not confirmed');
  ok(d.update(true) === null, 'back to old state: pending change dropped');
  ok(d.update(false) === null && d.update(false)?.value === false, 'two polls in a row: confirmed (false)');
  ok(d.update(false) === null, 'no repeat while the state stays');
  ok(d.update(true) === null, 'new candidate 1');
  ok(d.update(null) === null, 'unknown reading resets the count');
  ok(d.update(true) === null && d.update(true)?.value === true, 'needs 2 polls again after unknown');
  const d2 = new StateDebouncer<boolean>(2); d2.update(true);
  d2.update(null); ok(d2.update(false) === null && d2.update(false)?.value === false, 'change while unknown is confirmed afterwards (reconnect)');
  const d3 = new StateDebouncer<boolean>(2); d3.update(true); d3.update(false); d3.reset();
  ok(d3.update(false) === null, 'reset() drops the pending change');
  // change tracker
  const t = new ChangeTracker();
  ok(!t.changed('a', 5), 'first value is no change');
  ok(!t.changed('a', 5), 'same value is no change');
  ok(t.changed('a', 6), 'different value is a change');
  ok(!t.changed('b', 6), 'keys are independent');

  // real devices with a fake trigger card
  const fired: any[] = [];
  const mkHomey = (inv: any) => ({ clock: { getTimezone: () => 'Europe/Amsterdam' }, setTimeout, setInterval, clearInterval,
    flow: { getDeviceTriggerCard: (id: string) => ({ trigger: async (dev: any, tokens: any) => { fired.push([id, tokens]); } }) },
    drivers: { getDriver: () => ({ getDevices: () => [inv] }) } });
  const { Deye } = require('../lib/deye');
  const dev = new Deye(); dev.homey = mkHomey(null); dev.getStoreValue = () => undefined; dev.setStoreValue = async () => {};
  const m = (v: number, scale = 0, group = 'inverter') => ({ value: String(v), scale, label: '', group });
  const snap = (volt: number, load: number, grid: number) => ({ l1gridvoltage: m(volt * 10, -1), loadtotalpower: m(load), gridpower: m(grid) });
  await dev.processDeyeResult(snap(230, 500, 100));
  ok(fired.length === 0, 'inverter: first poll fires nothing');
  await dev.processDeyeResult(snap(230, 520, 100));
  ok(fired.length === 1 && fired[0][0] === 'measure_consumption_power_changed' && fired[0][1].measure_consumption_power === 520, 'inverter: consumption change fires with token');
  await dev.processDeyeResult(snap(230, 520, 90));
  ok(fired[1][0] === 'measure_grid_power_changed' && fired[1][1].measure_grid_power === 90, 'inverter: grid power change fires with token');
  fired.length = 0;
  await dev.processDeyeResult(snap(0, 520, 90)); ok(fired.length === 0, 'grid lost, 1st poll: not yet');
  await dev.processDeyeResult(snap(0, 520, 90)); ok(fired.length === 1 && fired[0][0] === 'grid_available_false', 'grid lost, 2nd poll: grid_available_false');
  fired.length = 0;
  await dev.processDeyeResult(snap(0, 520, 90)); ok(fired.length === 0, 'no repeat');
  await dev.processDeyeResult(snap(230, 520, 90)); dev.resetTriggerState(); await dev.processDeyeResult(snap(230, 520, 90));
  ok(fired.length === 0, 'failed poll in between restarts the count');
  await dev.processDeyeResult(snap(230, 520, 90)); ok(fired.length === 1 && fired[0][0] === 'grid_available_true', 'grid back: grid_available_true after 2 polls');
  fired.length = 0;
  await dev.processDeyeResult({ l1gridvoltage: m(2300, -1) });
  ok(fired.length === 0, 'missing consumption/grid readings fire nothing');

  const { EventEmitter } = require('events');
  const inv: any = { bus: new EventEmitter(), getSnapshot: () => ({}), getAvailable: () => true, getData: () => ({ id: 'inv1' }), getName: () => 'I' };
  const mk = (path: string) => { const C = require('../drivers/' + path + '/device'); const x = new C(); x.homey = mkHomey(inv); x.getStoreValue = () => 'inv1'; x.log = () => {}; return x; };
  const b = mk('battery'), s = mk('solar');
  const bs = (p: number) => ({ batterypower: m(p, 0, 'battery') });
  await b.processBatteryResult(bs(-100)); ok(fired.length === 0, 'battery: first poll fires nothing');
  await b.processBatteryResult(bs(-100)); ok(fired.length === 0, 'battery: same value fires nothing');
  await b.processBatteryResult(bs(-250)); ok(fired.length === 1 && fired[0][0] === 'measure_battery_power_changed' && fired[0][1].measure_battery_power === 250, 'battery: change fires with Homey sign: ' + JSON.stringify(fired[0]));
  fired.length = 0;
  const ss = (a: number, c: number) => ({ pv1inputpower: m(a, 0, 'solar'), pv2inputpower: m(c, 0, 'solar') });
  await s.processSolarResult(ss(300, 200)); ok(fired.length === 0, 'solar: first poll fires nothing');
  await s.processSolarResult(ss(400, 200)); ok(fired.length === 1 && fired[0][0] === 'measure_solar_power_changed' && fired[0][1].measure_solar_power === 600, 'solar: total changed fires');
  fired.length = 0;
  await s.processSolarResult(ss(20000, 200)); ok(fired.length === 0, 'solar: corrupt input fires nothing');
  console.log(f ? f + ' FAILED' : 'all passed'); process.exit(f ? 1 : 0);
})();
