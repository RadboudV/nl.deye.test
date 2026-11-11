import * as R from '../lib/registers';
import * as c from '../lib/controls';
let fails = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

(async () => {
  // ---- pure helpers
  ok(R.formatProtocol(0x0104) === 'v1.04' && R.formatProtocol(0x0210) === 'v2.16', 'formatProtocol');
  ok(R.findRegisterSet(0x0104) === R.V104 && R.findRegisterSet(0x0105) === null, 'findRegisterSet');
  const V105 = R.deriveSet(R.V104, {
    protocol: 0x0105,
    change: { batterypower: { address: 700 }, timeofusetime1: { address: 900 } },
    add: { newthing: { address: 750, length: 1, type: 'UINT16', label: 'New', scale: 0, group: 'inverter' } },
    remove: ['loadfrequency'],
  });
  ok(V105.name === 'v1.05' && V105.registers.batterypower.address === 700 && !V105.registers.loadfrequency && !!V105.registers.newthing && !V105.writesVerified, 'deriveSet add/change/remove, writes unverified by default');
  ok(R.V104.registers.batterypower.address === 590 && !!R.V104.registers.loadfrequency, 'deriveSet leaves the base untouched');
  let threw = false; try { R.deriveSet(R.V104, { protocol: 1, change: { nope: { address: 1 } } }); } catch { threw = true; } ok(threw, 'deriveSet rejects unknown key');
  // reading with a derived set uses its addresses
  const mem: Record<number, number> = { 700: 77, 750: 5, 2: 0x0105 };
  const reads: string[] = [];
  const client: any = { readHoldingRegisters: async (a: number, n: number) => { reads.push(`${a}+${n}`); return { response: { body: { valuesAsArray: Array.from({ length: n }, (_, i) => mem[a + i] ?? 0) } } }; } };
  const snap = await R.readAllRegisters(client, V105);
  ok(snap.batterypower.value === '77' && snap.newthing.value === '5' && !snap.loadfrequency, 'readAllRegisters follows the derived set');
  const id = await R.readIdentity(client);
  ok(id.protocol === 0x0105, 'readIdentity protocol');
  // controls look addresses up by key
  const written: string[] = [];
  const io: c.RegisterIO = { set: V105, read: async (a, n) => Array.from({ length: n }, (_, i) => mem[a + i] ?? 0), write: async (a, v) => { written.push(`${a}=${v}`); v.forEach((x, i) => (mem[a + i] = x)); }, pause: async () => {} };
  await c.setTimeslot(io, 1, { time: '07:15' }).then(() => ok(false, 'non-consecutive slot registers must be refused')).catch((e) => ok(e instanceof c.ControlError && /not consecutive/.test(e.message), 'controls refuse non-consecutive slot registers: ' + e.message));
  const noTou = R.deriveSet(R.V104, { protocol: 0x0106, remove: ['workmode'] });
  await c.setWorkMode({ ...io, set: noTou }, 'selling_first').then(() => ok(false, 'missing key')).catch((e) => ok(e instanceof c.ControlError && /not available on communication protocol v1.06/.test(e.message), 'missing key -> ' + e.message));
  ok(written.length === 0, 'nothing written in the refused cases');

  // ---- device behaviour with a fake inverter
  const Dev: any = require('../drivers/deye/device');
  const d = new Dev();
  const regmem: Record<number, number> = {};
  const writes: string[] = [];
  const fake: any = {
    readHoldingRegisters: async (a: number, n: number) => ({ response: { body: { valuesAsArray: Array.from({ length: n }, (_, i) => regmem[a + i] ?? 0) } } }),
    writeMultipleRegisters: async (a: number, v: number[]) => { writes.push(`${a}=${v}`); v.forEach((x, i) => (regmem[a + i] = x)); },
  };
  d.socket = { destroyed: false, connecting: false, readyState: 'open', removeAllListeners() {}, destroy() {} };
  d.client = fake;
  regmem[2] = 0x0104; regmem[3] = 0x4142; regmem[590] = 500; regmem[587] = 5300;
  await d.pollDeyeInverter('datavalues');
  ok(d.registerSet?.name === 'v1.04' && d.getSnapshot().batterypower?.value === '500', 'v1.04: register set selected, snapshot filled');
  ok(d.settings.protocolversion === 'v1.04 (0x0104)', 'protocol version shown in the settings: ' + d.settings.protocolversion);
  ok(d.availability === true, 'device available');
  d.lastWrite = 0;
  await d.control('Set max sell power', (io2: c.RegisterIO) => c.setMaxSellPower(io2, 4000));
  ok(regmem[143] === 4000, 'v1.04: write goes through');

  // unknown protocol version
  const snapBefore = JSON.stringify(d.getSnapshot()); writes.length = 0;
  regmem[2] = 0x0108; regmem[590] = 1234;
  await d.pollDeyeInverter('datavalues');
  ok(d.availability === false && /Unsupported communication protocol v1\.08 \(0x0108\)/.test(d.unavailableMessage), 'unknown version: device unavailable: ' + d.unavailableMessage);
  ok(JSON.stringify(d.getSnapshot()) === snapBefore, 'unknown version: no values decoded');
  ok(d.settings.protocolversion === 'v1.08 (0x0108) - not supported', 'unknown version shown: ' + d.settings.protocolversion);
  let msg = ''; await d.control('Set max sell power', (io2: c.RegisterIO) => c.setMaxSellPower(io2, 100)).catch((e: Error) => (msg = e.message));
  ok(/Unsupported communication protocol/.test(msg) && writes.length === 0, 'unknown version: card refused, nothing written: ' + msg);

  // back to a known version -> recovers
  d.lastWrite = 0; regmem[2] = 0x0104; await d.pollDeyeInverter('datavalues');
  ok(d.availability === true && d.getSnapshot().batterypower.value === '1234', 'known version again: available and values flow');

  // a version that is known but not verified for writes
  R.REGISTER_SETS.push(V105); d.lastWrite = 0; regmem[2] = 0x0105; regmem[700] = 42; await d.pollDeyeInverter('datavalues');
  ok(d.registerSet.name === 'v1.05' && d.getSnapshot().batterypower.value === '42', 'v1.05 (derived): reads use its map');
  msg = ''; writes.length = 0; await d.control('x', (io2: c.RegisterIO) => c.setMaxSellPower(io2, 100)).catch((e: Error) => (msg = e.message));
  ok(/not verified for communication protocol v1\.05/.test(msg) && writes.length === 0, 'unverified version: writes refused: ' + msg);
  msg = ''; await d.onSettings({ oldSettings: {}, newSettings: { settings_asymetricphasefeeding: true }, changedKeys: ['settings_asymetricphasefeeding'] }).catch((e: Error) => (msg = e.message));
  ok(writes.length === 0 && /not verified/.test(msg), 'unverified version: settings change refused, nothing written: ' + msg);
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
