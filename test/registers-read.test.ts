import { readBlocks, readAllRegisters, V104 } from '../lib/registers';

let fails = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

// fake inverter memory
const mem = new Array(800).fill(0);
mem[3] = 0x3231; mem[4] = 0x3433; mem[5] = 0x3635; mem[6] = 0x3837; mem[7] = 0x3039;
mem[516] = 100; mem[517] = 2;            // total charge = 2*65536+100
mem[590] = 0xFFF6;                       // -10 W (INT16)
mem[586] = 1253;
let calls: string[] = [];
const fail = new Set<number>();          // addresses that trigger a modbus exception
const client: any = { readHoldingRegisters: async (a: number, n: number) => {
  calls.push(`${a}+${n}`);
  for (let i = a; i < a + n; i++) if (fail.has(i)) throw { err: 'ModbusException' };
  return { response: { body: { valuesAsArray: mem.slice(a, a + n) } } };
} };

(async () => {
  const total = Object.keys(V104.registers).length;
  const blocks = readBlocks(V104);
  ok(blocks.reduce((n, b) => n + b.keys.length, 0) === total, `the read blocks cover all ${total} registers`);

  const un = new Set<string>();
  let r = await readAllRegisters(client, V104, un);
  ok(calls.length === blocks.length, `one request per block (${blocks.length})`);
  ok(Object.keys(r).length === total, 'every register is in the snapshot');
  ok(r.serial.value === '2143658709', `serial decoded: ${r.serial.value}`);
  ok(Number(r.batterytotalcharge.value) === 131172, `32-bit total charge: ${r.batterytotalcharge.value}`);
  ok(Number(r.batterypower.value) === -10, `signed 16-bit battery power: ${r.batterypower.value}`);
  ok(Number(r.batterytemperature.value) === 1253, 'battery temperature raw value');

  // a register the inverter rejects inside a block: the block is split up, only that register is skipped
  calls = []; fail.add(655);
  r = await readAllRegisters(client, V104, un);
  ok([...un].join() === 'loadfrequency' && Object.keys(r).length === total - 1, `rejected register skipped and remembered: ${[...un]}`);
  const firstBad = calls.length;
  calls = []; r = await readAllRegisters(client, V104, un);
  ok(calls.length < firstBad && Object.keys(r).length === total - 1, `next poll avoids the rejected register (${calls.length} requests instead of ${firstBad})`);

  // a timeout is thrown to the caller
  const c2: any = { readHoldingRegisters: async () => { throw { err: 'Timeout' }; } };
  let err: any = null;
  try { await readAllRegisters(c2, V104); } catch (e: any) { err = e; }
  ok(err && err.err === 'Timeout', 'timeout propagates');

  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
