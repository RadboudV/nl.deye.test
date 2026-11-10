import { DeyeBattery } from '../lib/battery';
import { readAllRegisters, V104 } from '../lib/registers';

let fails = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };

const mem = new Array(800).fill(0);
mem[514] = 123; mem[516] = 1000; mem[517] = 1; mem[590] = 500; mem[591] = 1050; mem[587] = 5321; mem[588] = 64; mem[586] = 1253; mem[210] = 5800; mem[212] = 100;
mem[3] = 0x4142;
const client: any = { readHoldingRegisters: async (a: number, n: number) => ({ response: { body: { valuesAsArray: mem.slice(a, a + n) } } }) };

(async () => {
  const d: any = new (DeyeBattery as any)();
  await d.processBatteryResult(await readAllRegisters(client, V104));
  ok(d.settings.maxchargevoltage === '58', `max charge voltage setting: ${d.settings.maxchargevoltage}`);
  ok(d.settings.chargecurrent === '100', `charge current setting: ${d.settings.chargecurrent}`);
  ok(d.settings.serial === 'AB', `serial setting: ${d.settings.serial}`);
  ok(Object.keys(d.caps).length > 0, `capabilities are filled: ${Object.keys(d.caps).length}`);
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
