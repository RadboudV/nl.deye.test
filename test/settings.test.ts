const ROOT = require('path').resolve(__dirname, '..', '..');   // repository root (this file runs from .testbuild/test)
import * as c from '../lib/controls';
import { V104 } from '../lib/registers';
import { settingsFromSnapshot, applySettingChanges, CONTROL_SETTING_IDS } from '../lib/settings';
const mem: Record<number, number> = {}; const log: string[] = [];
const io = (): c.RegisterIO => ({ set: V104,
  read: async (a, n) => Array.from({ length: n }, (_, i) => mem[a + i] ?? 0),
  write: async (a, v) => { log.push(`w ${a} [${v.join(',')}]`); v.forEach((x, i) => { mem[a + i] = x; }); },
  pause: async () => {} });
let f = 0; const ok = (b: boolean, s: string) => { if (!b) f++; console.log(b ? 'ok  ' : 'FAIL', s); };
const snap = (o: Record<string, number>): any => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: String(v), scale: 0, label: '', group: 'misc' }]));
(async () => {
  const fs = require('fs');
  const compose = JSON.parse(fs.readFileSync(ROOT + '/drivers/deye/driver.settings.compose.json', 'utf8'));
  const ids = compose.flatMap((g: any) => g.children ?? []).map((x: any) => x.id).filter((id: string) => /^settings_/.test(id) && id !== 'settings_timesync');
  ok(JSON.stringify([...ids].sort()) === JSON.stringify([...CONTROL_SETTING_IDS].sort()), 'every setting of the group is mapped, and the other way round: ' + ids.length);
  ok(['gridchargeenable', 'generatorchargeenable'].every((k) => V104.registers[k]) && V104.registers.gridchargeenable.address === 130 && V104.registers.generatorchargeenable.address === 129, 'registers 130 / 129 exist');

  // register -> settings
  const s1 = settingsFromSnapshot(snap({ maxsolarpower: 7000, generatorchargestartcapacity: 45, gridchargestartcapacity: 30, gridchargecurrent: 60, generatorchargecurrent: 55, gridgensignal: 0x02, batteryshutdowncapacity: 10, batteryrestartcapacity: 20, batterylowcapacity: 15, timeofuseweeklysellingschedule: 0x7F, solarsell: 1, gridchargeenable: 1, generatorchargeenable: 0, workmode: 2, energypattern: 1, gridpeakshavingmode: 0x30 | 0x04, gridpeakshavingpower: 5000, generatorpeakshavingpower: 3000, maxsellpower: 6000, asymetricphasefeeding: 1 }), {});
  const sorted = (o: any) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  ok(sorted(s1) === sorted({ settings_maxsolarsellpower: 7000, settings_generatorchargestartcapacity: 45, settings_gridchargestartcapacity: 30, settings_gridchargecurrent: 60, settings_generatorchargecurrent: 55, settings_gridsignal: false, settings_generatorsignal: true, settings_batteryshutdowncapacity: 10, settings_batteryrestartcapacity: 20, settings_batterylowcapacity: 15, settings_timeofuseenabled: true, settings_solarsellenabled: true, settings_energygridchargeenabled: true, settings_energygenchargeenabled: false, settings_workmode: 'ZERO_EXPORT_TO_CT', settings_energypriority: 'LOAD_FIRST', settings_energygridshavingenabled: true, settings_energygridshavingpower: 5000, settings_energygeneratorpower: 3000, settings_maxoutputtogrid: 6000, settings_asymetricphasefeeding: true }), 'all registers mapped: ' + JSON.stringify(s1));
  ok(Object.keys(settingsFromSnapshot(snap({ timeofuseweeklysellingschedule: 0x7F, workmode: 2 }), { settings_timeofuseenabled: true, settings_workmode: 'ZERO_EXPORT_TO_CT' })).length === 0, 'unchanged values give no setSettings');
  ok(settingsFromSnapshot(snap({ timeofuseweeklysellingschedule: 0x7E }), {}).settings_timeofuseenabled === false, 'TOU bit 0 off, day bits set -> false');
  ok(settingsFromSnapshot(snap({ gridpeakshavingmode: 0x20 }), {}).settings_energygridshavingenabled === false, 'grid shaving 0b10 -> off');
  ok(!('settings_workmode' in settingsFromSnapshot(snap({ workmode: 9 }), {})), 'unknown work mode ignored');
  ok(Object.keys(settingsFromSnapshot({}, {})).length === 0, 'empty snapshot -> nothing');

  // settings -> registers
  mem[146] = 0x7E; log.length = 0;
  await applySettingChanges(io(), ['settings_timeofuseenabled'], { settings_timeofuseenabled: true });
  ok(mem[146] === 0x7F, 'time of use on keeps the day bits: ' + mem[146].toString(2));
  await applySettingChanges(io(), ['settings_solarsellenabled', 'settings_energygridchargeenabled', 'settings_energygenchargeenabled'], { settings_solarsellenabled: true, settings_energygridchargeenabled: true, settings_energygenchargeenabled: true });
  ok(mem[145] === 1 && mem[130] === 1 && mem[129] === 1, 'solar sell 145, grid charge 130, generator charge 129 written');
  await applySettingChanges(io(), ['settings_energygridchargeenabled'], { settings_energygridchargeenabled: false });
  ok(mem[130] === 0 && mem[129] === 1, 'grid charge off only touches 130');
  await applySettingChanges(io(), ['settings_workmode'], { settings_workmode: 'ZERO_EXPORT_TO_LOAD' }); ok(mem[142] === 1, 'work mode zero export to load');
  mem[141] = 0x02; await applySettingChanges(io(), ['settings_energypriority'], { settings_energypriority: 'LOAD_FIRST' }); ok(mem[141] === 0x03, 'energy priority load first keeps other bits');
  await applySettingChanges(io(), ['settings_energypriority'], { settings_energypriority: 'BATTERY_FIRST' }); ok(mem[141] === 0x02, 'battery first clears bit 0');
  await applySettingChanges(io(), ['settings_maxoutputtogrid'], { settings_maxoutputtogrid: 4500 }); ok(mem[143] === 4500, 'max output to grid 143');
  await applySettingChanges(io(), ['settings_energygeneratorpower'], { settings_energygeneratorpower: 2500 }); ok(mem[190] === 2500, 'generator power 190');
  await applySettingChanges(io(), ['settings_asymetricphasefeeding'], { settings_asymetricphasefeeding: true }); ok(mem[237] === 1, 'asymetric phase feeding 237');
  await applySettingChanges(io(), ['settings_batteryshutdowncapacity', 'settings_batteryrestartcapacity', 'settings_batterylowcapacity'], { settings_batteryshutdowncapacity: 12, settings_batteryrestartcapacity: 25, settings_batterylowcapacity: 18 });
  ok(mem[115] === 12 && mem[116] === 25 && mem[117] === 18, 'battery capacity limits written to 115/116/117');
  let m2 = ''; await applySettingChanges(io(), ['settings_batterylowcapacity'], { settings_batterylowcapacity: 101 }).catch((e: Error) => (m2 = e.message));
  ok(/between 0 and 100/.test(m2), 'over 100 % refused: ' + m2);
  await applySettingChanges(io(), ['settings_generatorchargestartcapacity', 'settings_gridchargestartcapacity', 'settings_gridchargecurrent', 'settings_generatorchargecurrent'], { settings_generatorchargestartcapacity: 40, settings_gridchargestartcapacity: 35, settings_gridchargecurrent: 80, settings_generatorchargecurrent: 70 });
  ok(mem[124] === 40 && mem[127] === 35 && mem[128] === 80 && mem[125] === 70, 'charge start points 124/127, grid charge current 128 and generator charge current 125 written');
  mem[140] = 0x04; await applySettingChanges(io(), ['settings_gridsignal'], { settings_gridsignal: true }); ok(mem[140] === 0x05, 'grid signal sets bit 0, keeps other bits');
  await applySettingChanges(io(), ['settings_generatorsignal'], { settings_generatorsignal: true }); ok(mem[140] === 0x07, 'generator signal sets bit 1');
  await applySettingChanges(io(), ['settings_gridsignal'], { settings_gridsignal: false }); ok(mem[140] === 0x06, 'grid signal off clears only bit 0');
  let m3 = ''; await applySettingChanges(io(), ['settings_gridchargecurrent'], { settings_gridchargecurrent: 300 }).catch((e: Error) => (m3 = e.message)); ok(/between 0 and 240/.test(m3), 'current over the limit refused: ' + m3);
  await applySettingChanges(io(), ['settings_maxsolarsellpower'], { settings_maxsolarsellpower: 6500 }); ok(mem[340] === 6500, 'maximum solar sell power 340');
  // grid shaving pair
  mem[178] = 0x0C; log.length = 0;
  await applySettingChanges(io(), ['settings_energygridshavingenabled', 'settings_energygridshavingpower'], { settings_energygridshavingenabled: true, settings_energygridshavingpower: 7000 });
  ok(log[0] === 'w 191 [7000]' && mem[178] === (0x0C | 0x30), 'shaving on: power first, then mode bits, other bits kept: ' + log.join(' | '));
  log.length = 0;
  await applySettingChanges(io(), ['settings_energygridshavingpower'], { settings_energygridshavingenabled: true, settings_energygridshavingpower: 8000 });
  ok(mem[191] === 8000 && mem[178] === (0x0C | 0x30), 'power change while on');
  log.length = 0;
  await applySettingChanges(io(), ['settings_energygridshavingpower'], { settings_energygridshavingenabled: false, settings_energygridshavingpower: 9000 });
  ok(log.join('|') === 'w 191 [9000]' && mem[178] === 0x3C, 'power change while off only writes 191, mode bits untouched: ' + log.join('|'));
  await applySettingChanges(io(), ['settings_energygridshavingenabled'], { settings_energygridshavingenabled: false, settings_energygridshavingpower: 9000 });
  ok((mem[178] & 0x30) === 0x20 && (mem[178] & 0x0F) === 0x0C, 'shaving off = 0b10, other bits kept');
  // errors reach the user
  let msg = ''; await applySettingChanges(io(), ['settings_maxoutputtogrid'], { settings_maxoutputtogrid: 70000 }).catch((e: Error) => (msg = e.message));
  ok(/between 0 and 65535/.test(msg), 'out of range refused: ' + msg);
  msg = ''; await applySettingChanges(io(), ['settings_maxoutputtogrid'], { settings_maxoutputtogrid: null }).catch((e: Error) => (msg = e.message));
  ok(/required/.test(msg), 'empty value refused: ' + msg);
  console.log(f ? f + ' FAILED' : 'all passed'); process.exit(f ? 1 : 0);
})();
