const ROOT = require('path').resolve(__dirname, '..', '..');   // repository root (this file runs from .testbuild/test)
let f = 0; const ok = (c: boolean, s: string) => { if (!c) f++; console.log(c ? 'ok  ' : 'FAIL', s); };
const m = (v: number, scale = 0) => ({ value: String(v), scale, label: '', group: 'inverter' as const });
(async () => {
  const { Deye } = require('../lib/deye');
  const d = new Deye(); d.log = () => {}; d.debug = () => {};
  await d.processDeyeResult({ loaddailyconsumption: m(123, -1), loadtotalconsumption: m(45678, -1), loadtotalpower: m(-500) });
  ok(Math.abs(d.caps['meter_power.imported'] - 4567.8) < 1e-9 && Math.abs(d.caps['meter_power.dailyimported'] - 12.3) < 1e-9, 'imported = register 527/526 in kWh: ' + d.caps['meter_power.imported'] + ' / ' + d.caps['meter_power.dailyimported']);
  ok(!Object.keys(d.caps).some((k) => /export/i.test(k)), 'no exported capabilities');
  const x = new Deye(); x.log = () => {}; x.debug = () => {};
  await x.processDeyeResult({ gridpower: m(1) }); ok(!('meter_power.imported' in x.caps), 'no load counters in the snapshot -> nothing written');
  const c = JSON.parse(require('fs').readFileSync(ROOT + '/drivers/deye/driver.compose.json', 'utf8'));
  ok(!c.energy || !c.energy.cumulative, 'compose: no cumulative energy block (removed on main)');
  ok(c.capabilities.includes('meter_power.imported') && c.capabilities.includes('meter_power.dailyimported') && !c.capabilities.some((k: string) => /export/.test(k)), 'compose: imported capabilities declared, none exported');
  console.log(f ? f + ' FAILED' : 'all passed'); process.exit(f ? 1 : 0);
})();
