import { inverterModel } from '../lib/model';
import { REGISTER_SETS } from '../lib/registers';
let f = 0; const ok = (c: boolean, s: string) => { if (!c) f++; console.log(c ? 'ok  ' : 'FAIL', s); };
(async () => {
  ok(inverterModel(5, 4) === 'SG04LP3', 'type 0x0005 + generation 4 = SG04LP3');
  ok(inverterModel('5', '4') === 'SG04LP3', 'string values work too');
  ok(inverterModel(6, 4) === 'SG04HP3', 'high voltage three phase = SG04HP3');
  ok(inverterModel(0x0300, 1) === 'SG01LP1', 'single phase low voltage hybrid');
  ok(inverterModel(5, 0) === 'LP3', 'generation 0: only the type suffix');
  ok(inverterModel(0x1234, 4) === 'Unknown device type 0x1234', 'unknown device type is shown as is');
  ok(inverterModel(undefined, 4) === null && inverterModel(5, undefined) === null, 'missing register: null');
  ok(inverterModel('xx', 4) === null, 'not a number: null');
  const sets = Object.values(REGISTER_SETS) as any[];
  ok(sets.every((s) => s.registers.devicetype?.address === 0 && s.registers.inverterseries?.address === 28), 'device type (0) and generation (28) are read on every register set');
  process.exit(f ? 1 : 0);
})();
