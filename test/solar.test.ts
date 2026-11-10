import { EventEmitter } from 'events';
let f = 0; const ok = (c: boolean, s: string) => { if (!c) f++; console.log(c ? 'ok  ' : 'FAIL', s); };
const m = (v: number, scale = 0) => ({ value: String(v), scale, label: '', group: 'solar' as const });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // the real register table: all solar registers carry group 'solar' in the snapshot
  const R = require('../lib/registers');
  const mem: Record<number, number> = { 672: 1, 673: 2, 676: 3, 677: 4, 678: 5, 679: 6, 529: 7, 534: 8, 535: 9, 590: 10 };
  const client: any = { readHoldingRegisters: async (a: number, n: number) => ({ response: { body: { valuesAsArray: Array.from({ length: n }, (_, i) => mem[a + i] ?? 0) } } }) };
  const real = await R.readAllRegisters(client, R.V104);
  const solarKeys = Object.keys(real).filter((k) => real[k].group === 'solar').sort();
  ok(JSON.stringify(solarKeys) === JSON.stringify(['dailysolarproduction','pv1current','pv1inputpower','pv1voltage','pv2current','pv2inputpower','pv2voltage','totalsolarproduction']), 'snapshot: 8 registers in group solar: ' + solarKeys.join(','));
  ok(real.batterypower.group === 'battery' && real.gridpower.group === 'inverter', 'snapshot: other groups unchanged');

  const fakeInverter: any = { bus: new EventEmitter(), snap: {} as any, avail: true,
    getSnapshot() { return this.snap; }, getAvailable() { return this.avail; }, getData() { return { id: 'inv1' }; }, getName() { return 'Inverter'; } };
  const homeyStub = (inverters: any[]) => ({ setTimeout, setInterval, clearInterval, drivers: { getDriver: () => ({ getDevices: () => inverters }) }, __: (k: string) => k });

  const Solar: any = require('../drivers/solar/device');
  const s = new Solar(); s.homey = homeyStub([fakeInverter]); s.store = { inverterId: 'inv1' }; s.getStoreValue = (k: string) => s.store[k];
  fakeInverter.snap = { pv1inputpower: m(1200), pv2inputpower: m(800), pv1voltage: m(3105, -1), pv1current: m(39, -1), pv2voltage: m(2990, -1), pv2current: m(27, -1), dailysolarproduction: m(123, -1), totalsolarproduction: m(45678, -1) };
  await s.onInit();
  await sleep(50);
  const c = s.caps;
  ok(c['measure_power'] === 2000, 'total PV power = pv1 + pv2: ' + c['measure_power']);
  ok(c['measure_power.pv1inputpower'] === 1200 && c['measure_power.pv2inputpower'] === 800, 'pv1 / pv2 power');
  ok(Math.abs(c['measure_voltage.pv1voltage'] - 310.5) < 1e-9 && Math.abs(c['measure_current.pv2current'] - 2.7) < 1e-9, 'voltage / current scaled');
  ok(Math.abs(c['meter_power.dailysolarproduction'] - 12.3) < 1e-9 && Math.abs(c['meter_power'] - 4567.8) < 1e-9 && c['meter_power'] === c['meter_power.totalsolarproduction'], 'energy meters');
  ok(s.availability === true, 'available when the inverter is');
  fakeInverter.bus.emit('snapshot', { ...fakeInverter.snap, serial: { value: 'AB12', scale: 0, label: '', group: 'info' as const } }); await sleep(20);
  ok(s.settings.serial === 'AB12', 'serial of the inverter shown in the solar settings');

  // new snapshots flow through
  fakeInverter.bus.emit('snapshot', { ...fakeInverter.snap, pv1inputpower: m(300), pv2inputpower: m(0) }); await sleep(20);
  ok(c['measure_power'] === 300 && c['measure_power.pv2inputpower'] === 0, 'new snapshot processed (0 W is a valid value)');
  // corrupt reading is ignored
  fakeInverter.bus.emit('snapshot', { ...fakeInverter.snap, pv1inputpower: m(60000), pv2inputpower: m(100) }); await sleep(20);
  ok(c['measure_power.pv1inputpower'] === 300 && c['measure_power'] === 300, 'implausible pv1 ignored, total not updated: ' + c['measure_power']);
  // one input missing: total from the others only
  fakeInverter.bus.emit('snapshot', { pv2inputpower: m(250) }); await sleep(20);
  ok(c['measure_power'] === 250, 'missing PV1: total from PV2 only');
  // only group 'solar' is used: the same key in another group, or a non-solar key, is ignored
  fakeInverter.bus.emit('snapshot', { pv1inputpower: { ...m(777), group: 'inverter' }, pv2inputpower: m(100), batterypower: { ...m(5000), group: 'battery' } }); await sleep(20);
  ok(c['measure_power.pv1inputpower'] === 300 && c['measure_power'] === 100 && c['measure_power.pv2inputpower'] === 100, 'entries outside group solar are ignored');
  fakeInverter.bus.emit('snapshot', { pv2inputpower: m(250) }); await sleep(20);
  // availability follows the inverter
  fakeInverter.bus.emit('availability', false); await sleep(10);
  ok(s.availability === false && /not reachable/.test(s.unavailableMessage), 'unavailable with the inverter: ' + s.unavailableMessage);
  fakeInverter.bus.emit('availability', true); await sleep(10);
  ok(s.availability === true, 'available again');
  await s.onUninit();
  fakeInverter.bus.emit('snapshot', { pv2inputpower: m(999) }); await sleep(20);
  ok(c['measure_power'] === 250, 'no updates after uninit');

  // inverter not found
  const s2 = new Solar(); s2.homey = homeyStub([]); s2.getStoreValue = () => 'inv1';
  await s2.onInit(); await sleep(10);
  ok(s2.availability === false && /not found/.test(s2.unavailableMessage), 'missing inverter: ' + s2.unavailableMessage);
  await s2.onUninit();

  // battery still works through the shared link
  const Bat: any = require('../drivers/battery/device');
  const b = new Bat(); b.homey = homeyStub([fakeInverter]); b.getStoreValue = () => 'inv1';
  const bm = (v: number, scale = 0) => ({ ...m(v, scale), group: 'battery' as const });
  fakeInverter.snap = { batterypower: bm(500), batterypercentage: bm(80), batteryvoltage: bm(5300, -2), pv1inputpower: m(900), serial: { value: 'AB12', scale: 0, label: '', group: 'info' as const } };
  await b.onInit(); await sleep(50);
  ok(b.caps['measure_power'] === -500 && b.caps['measure_battery'] === 80, 'battery via shared link (sign inverted): ' + b.caps['measure_power']);
  ok(b.caps['measure_voltage.batteryvoltage'] === 53 && !('measure_power.pv1inputpower' in b.caps), 'battery ignores solar group entries');
  ok(b.settings.serial === 'AB12', 'battery takes the serial from group info');
  fakeInverter.bus.emit('snapshot', { batterypower: { ...bm(900), group: 'inverter' }, batterypercentage: bm(70) }); await sleep(20);
  ok(b.caps['measure_power'] === -500 && b.caps['measure_battery'] === 70, 'battery key outside group battery is ignored');
  await b.onUninit();

  // solar driver pairing
  const Drv: any = require('../drivers/solar/driver');
  const d = new Drv(); d.homey = homeyStub([fakeInverter]); d.getDevices = () => [];
  const list = await d.onPairListDevices();
  ok(list.length === 1 && list[0].data.id === 'inv1-solar' && list[0].store.inverterId === 'inv1', 'pairing lists the inverter');
  d.getDevices = () => [{ getStoreValue: () => 'inv1' }];
  await d.onPairListDevices().then(() => ok(false, 'should refuse'), (e: Error) => ok(e.message === 'pair.allhavesolar', 'no inverter without solar left: ' + e.message));
  d.homey = homeyStub([]);
  await d.onPairListDevices().then(() => ok(false, 'should refuse'), (e: Error) => ok(e.message === 'pair.noinverter_solar', 'no inverter at all: ' + e.message));
  console.log(f ? f + ' FAILED' : 'all passed'); process.exit(f ? 1 : 0);
})();
