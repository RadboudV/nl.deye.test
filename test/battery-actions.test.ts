const ROOT = require('path').resolve(__dirname, '..', '..');   // repository root (this file runs from .testbuild/test)
import * as c from '../lib/controls';
import { V104 } from '../lib/registers';
const mem: Record<number, number> = {};
const io = (): c.RegisterIO => ({ set: V104, read: async (a, n) => Array.from({ length: n }, (_, i) => mem[a + i] ?? 0),
  write: async (a, v) => { v.forEach((x, i) => { mem[a + i] = x; }); }, pause: async () => {} });
let f = 0; const ok = (b: boolean, s: string) => { if (!b) f++; console.log(b ? 'ok  ' : 'FAIL', s); };
(async () => {
  const fs = require('fs');
  const flow = JSON.parse(fs.readFileSync(ROOT + '/drivers/deye/driver.flow.compose.json', 'utf8'));
  const listeners: Record<string, (a: any) => Promise<void>> = {};
  const homey = { flow: { getActionCard: (id: string) => ({ registerRunListener: (fn: any) => { listeners[id] = fn; } }), getConditionCard: () => ({ registerRunListener() {} }), getDeviceTriggerCard: () => ({}) }, __: (k: string) => k };
  const D = require('../drivers/deye/driver'); const d = new D(); d.homey = homey; d.log = () => {}; await d.onInit();
  const dev = { control: async (_l: string, run: (io: c.RegisterIO) => Promise<void>) => run(io()) };
  const run = (id: string, args: any) => listeners[id]({ device: dev, ...args });
  const cards = flow.actions.filter((a: any) => a.id.startsWith('set_battery')).map((a: any) => a.id);
  ok(cards.length === 6 && cards.every((id: string) => typeof listeners[id] === 'function'), 'all 6 set_battery_* cards have a run listener');
  await run('set_battery_grid_charge', { onoff: 'on' }); ok(mem[130] === 1, 'grid charge on -> 130');
  await run('set_battery_grid_charge', { onoff: 'off' }); ok(mem[130] === 0, 'grid charge off -> 130');
  await run('set_battery_gen_charge', { onoff: 'on' }); ok(mem[129] === 1, 'generator charge on -> 129');
  await run('set_battery_grid_charge_current', { current: 45 }); ok(mem[128] === 45, 'grid charge current -> 128');
  await run('set_battery_low', { percent: 22 }); ok(mem[117] === 22, 'battery low -> 117');
  await run('set_battery_max_charge_current', { current: 90 }); ok(mem[218] === 90, 'max charge current -> 218');
  await run('set_battery_max_discharge_current', { current: 100 }); ok(mem[219] === 100, 'max discharge current -> 219');
  let m = ''; await run('set_battery_low', { percent: 150 }).catch((e: Error) => (m = e.message)); ok(/between 0 and 100/.test(m), 'invalid value refused: ' + m);
  const hint = flow.actions.filter((a: any) => ['set_battery_grid_charge', 'set_battery_gen_charge'].includes(a.id)).every((a: any) => /Time of Use/.test(a.hint?.en) && a.hint?.nl);
  ok(hint, 'grid / generator charge cards carry the Time of Use note (en + nl)');
  console.log(f ? f + ' FAILED' : 'all passed'); process.exit(f ? 1 : 0);
})();
