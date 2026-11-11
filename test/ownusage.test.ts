import { OwnEnergyCounter, MAX_GAP_MS } from '../lib/energycounter';
let f = 0; const ok = (c: boolean, s: string) => { if (!c) f++; console.log(c ? 'ok  ' : 'FAIL', s); };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const H = 3_600_000;
(async () => {
  const c = new OwnEnergyCounter();
  let r = c.update(100, 0, '2026-11-06');
  ok(r.daily === 0 && r.total === 0 && r.rolledOver, 'first reading: no energy yet (starts the day)');
  r = c.update(100, H, '2026-11-06'); // would exceed the max gap -> ignored
  ok(r.total === 0, 'gap > 10 min is not integrated');
  r = c.update(100, H + 30_000, '2026-11-06');
  ok(near(r.total, 100 * 30 / 3600 / 1000), '100 W for 30 s = 0.000833 kWh: ' + r.total);
  // one hour in 30 s steps at 120 W
  let t = H + 30_000; for (let i = 0; i < 120; i++) { t += 30_000; r = c.update(120, t, '2026-11-06'); }
  ok(Math.abs(r.daily - (0.000833333 + 0.1197)) < 0.001 && r.daily === r.total, 'one hour at ~120 W = ~0.12 kWh: ' + r.daily.toFixed(4));
  const dailyBefore = r.daily;
  // midnight: first reading on a new date resets the daily counter, total keeps counting
  r = c.update(120, t + 30_000, '2026-11-07');
  ok(r.rolledOver && r.daily < 0.0011 && r.total > dailyBefore, `midnight: daily back to ~0 (one polling interval at most is attributed to the new day) (${r.daily.toFixed(5)}), total kept (${r.total.toFixed(4)})`);
  r = c.update(120, t + 60_000, '2026-11-07');
  ok(!r.rolledOver && r.daily > 0.0009, 'same day: keeps counting');
  // negative power counts as 0
  const n = new OwnEnergyCounter(); n.update(-50, 0, 'd'); const rn = n.update(-50, 30_000, 'd');
  ok(rn.total === 0, 'negative power counts as 0');
  // restart: state is restored; a short restart keeps integrating, a long one does not
  const saved = JSON.parse(JSON.stringify(c.state));
  const c2 = new OwnEnergyCounter(saved); const k = c2.update(120, saved.ts + 20_000, '2026-11-07');
  ok(k.total > saved.total, 'restored state continues');
  const c3 = new OwnEnergyCounter(saved); const k3 = c3.update(120, saved.ts + MAX_GAP_MS + 1, '2026-11-07');
  ok(near(k3.total, saved.total), 'long downtime: nothing invented');
  ok(new OwnEnergyCounter({ total: NaN as any, daily: 'x' as any } as any).state.total === 0, 'corrupt saved state -> 0');

  // through the inverter device class: capabilities, persistence, midnight
  const { Deye } = require('../lib/deye');
  const d = new Deye(); d.log = () => {}; d.debug = () => {};
  const m = (v: number) => ({ value: String(v), scale: 0, label: '', group: 'inverter' as const });
  const snap = { gridpower: m(300), pv1inputpower: m(100), pv2inputpower: m(100), batterypower: m(-200), loadtotalpower: m(450) };   // own = 300+100+100-200-450 = -150? (see formula)
  const realDate = Date.now; let now = Date.parse('2026-11-06T10:00:00Z'); (Date as any).now = () => now;
  const own = Number(snap.gridpower.value) + 100 + 100 - (-Number(snap.batterypower.value)) - 450;
  await d.processDeyeResult(snap);
  ok(d.caps['measure_power.deyeownconsumption'] === own, 'own power as before: ' + own);
  ok('meter_power.deyeowndailyconsumption' in d.caps && 'meter_power.deyeowntotalconsumption' in d.caps, 'counter capabilities created');
  const snap2 = { ...snap, loadtotalpower: m(0) };   // own = 300+200-200... positive
  const pos = 300 + 100 + 100 - 200 - 0;
  now += 60_000; await d.processDeyeResult(snap2);
  ok(Math.abs(d.caps['meter_power.deyeowntotalconsumption'] - ((Math.max(0, own) + pos) / 2 * 60 / 3.6e6)) < 0.0006, 'device: energy after 60 s: ' + d.caps['meter_power.deyeowntotalconsumption']);
  ok(d.store.ownUsageCounter.total === 0, 'store written at the first reading, not on every poll (throttled)');
  now += 6 * 60_000; await d.processDeyeResult(snap2);
  ok(d.store.ownUsageCounter.total > 0.002, 'state saved to the store after 5 minutes: ' + d.store.ownUsageCounter.total.toFixed(4));
  // midnight Amsterdam (UTC+1): 23:00 UTC
  now = Date.parse('2026-11-06T22:59:30Z'); await d.processDeyeResult(snap2);
  const dailyBeforeMidnight = d.caps['meter_power.deyeowndailyconsumption'];
  now = Date.parse('2026-11-06T22:59:30Z') + 1000; await d.processDeyeResult(snap2); const dayBefore = d.caps['meter_power.deyeowndailyconsumption'];
  now = Date.parse('2026-11-06T23:00:30Z'); await d.processDeyeResult(snap2);
  ok(d.caps['meter_power.deyeowndailyconsumption'] < 0.0051 && d.caps['meter_power.deyeowndailyconsumption'] < dailyBeforeMidnight + 0.0051 && d.caps['meter_power.deyeowntotalconsumption'] >= dailyBeforeMidnight, `device: daily back to ~0 at 00:00 local time (${dailyBeforeMidnight.toFixed(4)} -> ${d.caps['meter_power.deyeowndailyconsumption'].toFixed(4)})`);
  (Date as any).now = realDate;
  console.log(f ? f + ' FAILED' : 'all passed'); process.exit(f ? 1 : 0);
})();
