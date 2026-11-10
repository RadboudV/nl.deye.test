import * as ts from '../lib/timesync';
import { V104 } from '../lib/registers';
const mem: Record<number, number> = {}; const log: string[] = [];
const io = (): any => ({ set: V104, read: async (a: number, n: number) => Array.from({ length: n }, (_, i) => mem[a + i] ?? 0),
  write: async (a: number, v: number[]) => { log.push(`w ${a} [${v.join(',')}]`); v.forEach((x, i) => { mem[a + i] = x; }); }, pause: async () => {} });
let f = 0; const ok = (b: boolean, s: string) => { if (!b) f++; console.log(b ? 'ok  ' : 'FAIL', s); };
const TZ = 'Europe/Amsterdam';
const now = Date.parse('2026-11-10T11:00:30Z');            // 12:00:30 in Amsterdam (CET)
(async () => {
  const lp = ts.localParts(now, TZ);
  ok(lp.hour === 12 && lp.minute === 0 && lp.second === 30 && lp.day === 10 && lp.year === 2026, 'Homey local time in the Homey time zone: ' + JSON.stringify(lp));
  ok(JSON.stringify(ts.encodeTime(lp)) === JSON.stringify([(26 << 8) | 11, (10 << 8) | 12, (0 << 8) | 30]), 'encoding 62..64: ' + ts.encodeTime(lp).join(','));
  ok(JSON.stringify(ts.decodeTime(ts.encodeTime(lp))) === JSON.stringify(lp), 'decode(encode(x)) = x');
  ok(ts.decodeTime([0, 0, 0]) === null, 'all zero = no valid time');
  const set = (p: ts.TimeParts) => ts.encodeTime(p).forEach((w, i) => (mem[62 + i] = w));
  // inverter 40 s ahead -> daily check syncs
  set({ ...lp, second: 70 - 60, minute: 1 }); log.length = 0;
  let r = await ts.syncInverterTime(io(), TZ, false, () => now);
  ok(r.status === 'synced' && r.deltaMs === 40000 && log.join() === 'w 62 [6667,2572,30]'.replace('6667', String((26 << 8) | 11)).replace('2572', String((10 << 8) | 12)), 'delta 40 s: synced, one block write: ' + log.join() + ' ' + JSON.stringify(r));
  // inverter 5 minutes behind -> daily check refuses and writes nothing
  set({ ...lp, minute: 55, hour: 11 }); log.length = 0;
  r = await ts.syncInverterTime(io(), TZ, false, () => now);
  ok(r.status === 'too-far' && log.length === 0 && r.deltaMs === -300000, 'delta -5 min: too-far, nothing written: ' + JSON.stringify(r));
  // exactly 60 s is still fine, 61 s is not
  set({ ...lp, second: 30, minute: 1 }); r = await ts.syncInverterTime(io(), TZ, false, () => now); ok(r.status === 'synced', '60 s ahead: synced');
  set({ ...lp, second: 31, minute: 1 }); r = await ts.syncInverterTime(io(), TZ, false, () => now); ok(r.status === 'too-far', '61 s ahead: too-far');
  // switching on (force) fixes a clock that is hours off
  set({ ...lp, hour: 7 }); log.length = 0; r = await ts.syncInverterTime(io(), TZ, true, () => now);
  ok(r.status === 'synced' && log.length === 1 && ts.decodeTime([mem[62], mem[63], mem[64]])!.hour === 12, 'force: wrong clock corrected');
  // invalid inverter time
  mem[62] = mem[63] = mem[64] = 0; r = await ts.syncInverterTime(io(), TZ, false, () => now); ok(r.status === 'too-far' && r.deltaMs === null, 'invalid time: daily check switches off');
  r = await ts.syncInverterTime(io(), TZ, true, () => now); ok(r.status === 'synced', 'invalid time: force writes');
  // summer time
  const summer = Date.parse('2026-07-01T10:00:00Z'); ok(ts.localParts(summer, TZ).hour === 12, 'DST: 12:00 local in summer');
  // inverter ignores the write
  const stuck = io(); stuck.write = async () => {}; set({ ...lp, hour: 7 }); let msg = '';
  await ts.syncInverterTime(stuck, TZ, true, () => now).catch((e: Error) => (msg = e.message)); ok(/did not accept/.test(msg), 'write not accepted -> error: ' + msg);
  ok(ts.formatDelta(40000) === '40 seconds ahead' && ts.formatDelta(-330000) === '6 minutes behind', 'delta text: ' + ts.formatDelta(-330000));
  console.log(f ? f + ' FAILED' : 'all passed'); process.exit(f ? 1 : 0);
})();
