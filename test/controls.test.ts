import * as c from '../lib/controls';
import { V104 } from '../lib/registers';
// fake inverter register file
const mem: Record<number, number> = {};
const log: string[] = [];
const io = (opts: { clamp?: Record<number, number> } = {}): c.RegisterIO => ({
  set: V104,
  read: async (a, n) => Array.from({ length: n }, (_, i) => mem[a + i] ?? 0),
  write: async (a, v) => { log.push(`w ${a} [${v.join(',')}]`); v.forEach((x, i) => { mem[a + i] = opts.clamp?.[a + i] ?? x; }); },
  pause: async () => {},
});
const bin = (n: number) => '0b' + n.toString(2).padStart(8, '0');
let fails = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const rejects = async (p: Promise<any>, re: RegExp, msg: string) => { try { await p; ok(false, msg + ' (no error)'); } catch (e: any) { ok(re.test(e.message) && e instanceof c.ControlError, `${msg} -> ${e.message}`); } };
(async () => {
  // slot 2 flags: mode=Charge(3<<2=0x0C), grid on => 0x0D
  mem[173] = 0x0D;
  log.length = 0;
  await c.setTimeslot(io(), '2', { sell: 'on', generator: 'on', grid: 'keep' });
  ok(mem[173] === (0x0D | 0x20 | 0x02), `sell+gen on keeps mode and grid bits: ${bin(mem[173])}`);
  await c.setTimeslot(io(), '2', { grid: 'off', sell: 'off' });
  ok(mem[173] === (0x0C | 0x02), `grid+sell off keeps mode and gen bit: ${bin(mem[173])}`);
  log.length = 0;
  await c.setTimeslot(io(), 2, { grid: 'keep', generator: 'keep', sell: 'keep', power: 3500, soc: 40, time: '06:30' });
  ok(JSON.stringify(log) === JSON.stringify(['w 155 [3500]', 'w 167 [40]', 'w 149 [630]']), 'write order power, soc, time last; no flag write: ' + log.join(' | '));
  log.length = 0;
  await c.setTimeslot(io(), 2, { grid: 'on' }); await c.setTimeslot(io(), 2, { grid: 'on' });
  ok(log.length === 1, 'flag already set -> no second write');
  await c.setTimeslot(io(), 6, { time: '23:59' }); ok(mem[153] === 2359, 'time 23:59 -> 2359');
  await c.setTimeslot(io(), 1, { time: '0:05' }); ok(mem[148] === 5, 'time 0:05 -> 5');
  // all timeslots with different modes per slot
  [0x04, 0x0D, 0x00, 0x1C | 1, 0x21, 0x0F].forEach((v, i) => (mem[172 + i] = v));
  log.length = 0;
  await c.setAllTimeslots(io(), { power: 8000, soc: 25, grid: 'off', generator: 'keep', sell: 'on' });
  ok(JSON.stringify(log) === JSON.stringify(['w 154 [8000,8000,8000,8000,8000,8000]', 'w 166 [25,25,25,25,25,25]', 'w 172 [36,44,32,60,32,46]']), 'all slots, 3 block writes, per-slot bits preserved: ' + log.join(' | '));
  await rejects(c.setAllTimeslots(io(), {}), /Nothing to change/, 'all unchanged rejected');
  await rejects(c.setTimeslot(io(), 7, { power: 1 }), /Timeslot must be/, 'slot 7');
  await rejects(c.setTimeslot(io(), 1, { time: '25:00' }), /Invalid time/, 'bad time');
  await rejects(c.setTimeslot(io(), 1, { soc: 101 }), /Minimum SOC/, 'soc 101');
  await rejects(c.setTimeslot(io(), 1, { power: -5 }), /Power limit/, 'negative power');
  await rejects(c.setTimeslot(io(), 1, { power: 12.5 }), /whole number/, 'fractional power');
  await rejects(c.setTimeslot(io(), 1, { grid: 'maybe' }), /unknown option/, 'bad flag');
  await rejects(c.setTimeslot(io(), 1, { power: '' , soc: '' }), /Nothing to change/, 'empty strings = unchanged');
  // inverter clamps a value -> read-back mismatch reported
  await rejects(c.setTimeslot(io({ clamp: { 154: 5000 } }), 1, { power: 9000 }), /did not accept/, 'read-back mismatch');
  // other controls
  mem[141] = 0x0100; await c.setEnergyPattern(io(), 'load_first'); ok(mem[141] === 0x0101, 'energy pattern bit0 only');
  await c.setEnergyPattern(io(), 'batt_first'); ok(mem[141] === 0x0100, 'energy pattern back, high byte kept');
  mem[178] = 0x0F; await c.setGridPeakShavingOn(io(), 4000); ok(mem[178] === 0x3F && mem[191] === 4000, `peak shaving on: ${bin(mem[178])}`);
  await c.setGridPeakShavingOff(io()); ok(mem[178] === 0x2F, `peak shaving off: ${bin(mem[178])}`);
  mem[146] = 0x0001; await c.setTimeOfUseDay(io(), '3', 'on'); ok(mem[146] === 0x0009, 'Wednesday = bit3');
  await c.setTimeOfUseEnabled(io(), 'off'); ok(mem[146] === 0x0008, 'TOU off keeps day bits');
  await c.setTimeOfUseDay(io(), 7, 'on'); ok(mem[146] === 0x0088, 'Sunday = bit7');
  await rejects(c.setTimeOfUseDay(io(), 0, 'on'), /Day must be/, 'day 0');
  await c.setWorkMode(io(), 'zero_export_to_ct'); ok(mem[142] === 2, 'work mode');
  log.length = 0; await c.setWorkMode(io(), 'zero_export_to_load', 40); ok(mem[104] === 40 && mem[142] === 1 && log[0].startsWith('w 104'), 'work mode + zero export power x1, power first: ' + log.join(' | '));
  await c.setZeroExportPower(io(), -20); ok(mem[104] === 0xFFEC, 'negative zero export power as signed 16 bit: ' + mem[104]);
  await c.setZeroExportPower(io(), '25'); ok(mem[104] === 25, 'zero export 25 W -> raw 25');
  await rejects(c.setZeroExportPower(io(), 900), /Zero export power/, 'zero export out of range');
  await rejects(c.setZeroExportPower(io(), ''), /required/, 'zero export required');
  log.length = 0; await c.setWorkMode(io(), 'selling_first', ''); ok(log.length === 1, 'empty power keeps register 104');
  await rejects(c.setWorkMode(io(), 'nope'), /Unknown work mode/, 'bad mode');
  await c.setSolarSell(io(), 'on'); ok(mem[145] === 1, 'solar sell');
  await c.setMaxSellPower(io(), 5000); await c.setMaxSolarPower(io(), 12000); ok(mem[143] === 5000 && mem[340] === 12000, 'max sell / solar');
  await rejects(c.setMaxSellPower(io(), 70000), /between 0 and 65535/, 'power too high');
  await c.writeRawRegister(io(), 237, 1); ok(mem[237] === 1, 'raw write');
  await rejects(c.writeRawRegister(io(), 70000, 1), /Register address/, 'raw bad address');
  await rejects(c.setGridPeakShavingOn(io(), ''), /required/, 'peak shaving on without power');
  await rejects(c.setGridPeakShavingOn(io(), undefined), /required/, 'peak shaving on, power undefined');
  await rejects(c.setMaxSellPower(io(), ''), /required/, 'max sell power empty (was silently 0)');
  await rejects(c.setGridPeakShavingOn(io(), 'abc'), /must be a number/, 'peak shaving power not a number');
  mem[178] = 0x0F; await c.setGridPeakShavingOn(io(), 1500); ok(mem[191] === 1500, 'peak shaving 1500 W (not a multiple of 1000)');
  await c.setGridPeakShavingOff(io()); ok((mem[178] & 0x30) === 0x20, 'peak shaving off needs no power');
  console.log(fails ? `${fails} FAILED` : 'all passed');
})();
