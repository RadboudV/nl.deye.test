import { EventEmitter } from 'events';
let f = 0; const ok = (c: boolean, s: string) => { if (!c) f++; console.log(c ? 'ok  ' : 'FAIL', s); };
const gm = (v: number, scale = 0, group: any = 'generator') => ({ value: String(v), scale, label: '', group });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const R = require('../lib/registers');
  const mem: Record<number, number> = { 190: 8000, 512: 125, 513: 0, 536: 42, 661: 2301, 662: 2302, 663: 2303, 664: 100, 665: 200, 666: 300, 667: 600, 590: 10 };
  const client: any = { readHoldingRegisters: async (a: number, n: number) => ({ response: { body: { valuesAsArray: Array.from({ length: n }, (_, i) => mem[a + i] ?? 0) } } }) };
  const real = await R.readAllRegisters(client, R.V104);
  const keys = Object.keys(real).filter((k) => real[k].group === 'generator').sort();
  ok(keys.length === 10 && keys.includes('generatorpeakshavingpower') && keys.includes('generatorworkingtime'), '10 registers in group generator: ' + keys.join(','));
  ok(real.generatorworkingtime.value === '125' && real.generatorworkingtime.scale === -1 && real.generatorpeakshavingpower.value === '8000', 'new registers decoded (UINT32 hours, peak shaving)');
  ok(real.pv1inputpower.group === 'solar' && real.gridpower.group === 'inverter', 'other groups unchanged');
  const addrs = Object.values(R.V104.registers).map((d: any) => d.address + ':' + d.length);
  const seen = new Set<number>(); let overlap = 0;
  for (const d of Object.values<any>(R.V104.registers)) for (let i = 0; i < d.length; i++) { if (seen.has(d.address + i) && !(d.group === 'tou')) overlap++; seen.add(d.address + i); }
  console.log('info: overlapping addresses outside tou:', overlap);

  const inv: any = { bus: new EventEmitter(), snap: real, getSnapshot() { return this.snap; }, getAvailable() { return true; }, getData() { return { id: 'inv1' }; }, getName() { return 'Inverter'; } };
  const homeyStub = (l: any[]) => ({ setTimeout, setInterval, clearInterval, drivers: { getDriver: () => ({ getDevices: () => l }) }, __: (k: string) => k });
  const Gen: any = require('../drivers/generator/device');
  const g = new Gen(); g.homey = homeyStub([inv]); g.getStoreValue = () => 'inv1';
  await g.onInit(); await sleep(50);
  const c = g.caps;
  ok(c['measure_power'] === 600 && c['measure_power.generatorl1power'] === 100 && c['measure_power.generatorl3power'] === 300, 'power values');
  ok(Math.abs(c['measure_voltage.generatorl2voltage'] - 230.2) < 1e-9, 'voltage scaled');
  ok(Math.abs(c['generatorworkingtime'] - 12.5) < 1e-9 && c['meter_power.generatordailyproduction'] === 42, 'working time (h) and daily production');
  ok(g.settings.peakshavingpower === '8000', 'peak shaving power shown as a setting');
  inv.bus.emit('snapshot', { serial: { value: 'AB12', scale: 0, label: '', group: 'info' } }); await sleep(20);
  ok(g.settings.serial === 'AB12', 'serial shown in settings');
  // other groups ignored
  inv.bus.emit('snapshot', { generatortotalpower: gm(9999, 0, 'inverter'), generatorl1power: gm(111) }); await sleep(20);
  ok(c['measure_power'] === 600 && c['measure_power.generatorl1power'] === 111, 'entries outside group generator ignored');
  // device does not take solar / battery registers
  ok(!('measure_power.pv1inputpower' in c) && !('measure_battery' in c), 'no solar/battery capabilities');
  await g.onUninit();

  const Drv: any = require('../drivers/generator/driver');
  const d = new Drv(); d.homey = homeyStub([inv]); d.getDevices = () => [];
  const list = await d.onPairListDevices();
  ok(list.length === 1 && list[0].data.id === 'inv1-generator' && list[0].store.inverterId === 'inv1' && /generator/.test(list[0].name), 'pairing lists the inverter: ' + list[0].name);
  d.getDevices = () => [{ getStoreValue: () => 'inv1' }];
  await d.onPairListDevices().then(() => ok(false, 'refuse'), (e: Error) => ok(e.message === 'pair.allhavegenerator', 'all have generator'));
  d.homey = homeyStub([]);
  await d.onPairListDevices().then(() => ok(false, 'refuse'), (e: Error) => ok(e.message === 'pair.noinverter_generator', 'no inverter'));
  console.log(f ? f + ' FAILED' : 'all passed'); process.exit(f ? 1 : 0);
})();
