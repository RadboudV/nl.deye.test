import { decodeAlarms, diffAlarms, faultCodeForBit, alarmItemFromKey, FAULT_DESCRIPTIONS } from '../lib/errorcodes';
import { V104 } from '../lib/registers';

let fails = 0;
const ok = (condition: boolean, message: string) => { if (!condition) { fails++; console.log('FAIL', message); } else console.log('ok  ', message); };
const noFaults = [0, 0, 0, 0];
const noWarnings = [0, 0];

(async () => {
  // registers
  ok(['warningword1', 'warningword2', 'faultword1', 'faultword2', 'faultword3', 'faultword4'].every((key, index) => V104.registers[key]?.address === 553 + index && V104.registers[key].group === 'alarm'), 'registers 553-558 exist in group alarm');

  // bit layout: F01..F64 in order over the four words
  ok(faultCodeForBit(1, 0) === 1 && faultCodeForBit(1, 15) === 16 && faultCodeForBit(2, 0) === 17 && faultCodeForBit(4, 15) === 64, 'fault bit layout: word 1 bit 0 = F01 ... word 4 bit 15 = F64');
  ok(decodeAlarms(noFaults, noWarnings)!.length === 0, 'nothing set: no alarms');
  const grid = decodeAlarms([0, 0, 1 << 2, 0], noWarnings)!;      // word 3 bit 2 = code 35
  ok(grid.length === 1 && grid[0].key === 'F35' && grid[0].kind === 'fault' && grid[0].text === 'F35: No AC grid', 'F35 No AC grid decoded: ' + grid[0]?.text);
  const several = decodeAlarms([1 << 12, (1 << 1) | (1 << 3), 0, 1 << 15], noWarnings)!.map((item) => item.code);
  ok(JSON.stringify(several) === JSON.stringify(['F13', 'F18', 'F20', 'F64']), 'several faults over several words, in register order: ' + several);
  ok(decodeAlarms([1 << 1, 0, 0, 0], noWarnings)![0].text === 'F02: Unknown fault', 'a code without description: Unknown fault');

  // warnings
  const warnings = decodeAlarms(noFaults, [(1 << 1) | (1 << 2) | (1 << 3) | 1, (1 << 14) | (1 << 15)])!.map((item) => `${item.kind}:${item.text}`);
  ok(warnings.length === 5 && warnings[0] === 'warning:W02: Fan warning' && warnings[1] === 'warning:W03: Grid phase wrong' && warnings[3] === 'warning:W2.14: Lithium battery lost', 'warnings decoded, reserved bit 0 ignored: ' + warnings.join(' | '));
  ok(decodeAlarms(noFaults, [1 << 9, 0])![0].text === 'W1.9: Unknown warning', 'unknown warning bit is still reported');

  // bad reads
  ok(decodeAlarms([0xFFFF, 0, 0, 0], noWarnings) === null, 'a word with every bit set is a corrupt read');
  ok(decodeAlarms([NaN, 0, 0, 0], noWarnings) === null && decodeAlarms([0, 0, 0], noWarnings) === null, 'missing word: no result');

  // diff
  const previousKeys = ['F35', 'W02'];
  const { raised, cleared } = diffAlarms(previousKeys, decodeAlarms([1 << 12, 0, 0, 0], noWarnings)!.concat(decodeAlarms(noFaults, [1 << 1, 0])!));
  ok(raised.map((item) => item.key).join() === 'F13' && cleared.map((item) => item.key).join() === 'F35', 'diff: F13 raised, F35 cleared, W02 unchanged');
  ok(alarmItemFromKey('F35').description === 'No AC grid' && alarmItemFromKey('W2.15').kind === 'warning' && alarmItemFromKey('W03').text === 'W03: Grid phase wrong', 'items can be rebuilt from stored keys');
  ok(Object.values(FAULT_DESCRIPTIONS).every((text) => text.length > 0), 'every code has a description');

  // ---- on the device: capability, notifications and triggers
  const notifications: string[] = [];
  const fired: any[] = [];
  const { Deye } = require('../lib/deye');
  const makeDevice = () => {
    const device = new Deye();
    device.homey = {
      clock: { getTimezone: () => 'Europe/Amsterdam' }, setTimeout, setInterval, clearInterval,
      flow: { getDeviceTriggerCard: (id: string) => ({ trigger: async (_device: any, tokens: any) => { fired.push([id, tokens]); } }) },
      notifications: { createNotification: async ({ excerpt }: any) => { notifications.push(excerpt); } },
    };
    device.getName = () => 'Deye';
    return device;
  };
  const snapshot = (faults: number[], warnings: number[] = [0, 0]) => {
    const words: Record<string, number> = { warningword1: warnings[0], warningword2: warnings[1], faultword1: faults[0], faultword2: faults[1], faultword3: faults[2], faultword4: faults[3] };
    return Object.fromEntries(Object.entries(words).map(([key, value]) => [key, { value: String(value), scale: 0, label: '', group: 'alarm' }]));
  };
  const poll = (device: any, faults: number[], warnings?: number[]) => device.processAlarms(snapshot(faults, warnings));

  let device = makeDevice();
  await poll(device, [0, 0, 0, 0]);
  ok(device.caps.alarm_generic === false && device.caps.deye_error === 'No fault' && notifications.length === 0 && fired.length === 0, 'first poll without faults: flag off, "No fault", no notification, no trigger');

  await poll(device, [0, 0, 1 << 2, 0]);
  ok(device.caps.alarm_generic === true && device.caps.deye_error === 'F35: No AC grid', 'fault: alarm_generic on, code with description in the text capability');
  ok(notifications.length === 1 && notifications[0] === 'Deye: fault F35: No AC grid', 'fault: one notification with code and description: ' + notifications[0]);
  ok(fired.length === 1 && fired[0][0] === 'fault_detected' && fired[0][1].code === 'F35' && fired[0][1].description === 'No AC grid', 'fault: fault_detected trigger with code and description tokens');

  await poll(device, [0, 0, 1 << 2, 0]);
  ok(notifications.length === 1 && fired.length === 1, 'same fault next poll: nothing repeated');

  await poll(device, [1 << 12, 0, 1 << 2, 0]);
  ok(device.caps.deye_error === 'F13: Inverter work mode changed; F35: No AC grid' && fired.length === 2 && fired[1][1].code === 'F13', 'second fault added: both shown, only the new one is reported');

  await poll(device, [1 << 12, 0, 0, 0]);
  ok(device.caps.alarm_generic === true && notifications[notifications.length - 1] === 'Deye: fault cleared - F35: No AC grid' && fired[fired.length - 1][0] === 'fault_cleared' && fired[fired.length - 1][1].code === 'F35', 'one fault cleared: alarm stays on, cleared notification and trigger');

  await poll(device, [0, 0, 0, 0]);
  ok(device.caps.alarm_generic === false && device.caps.deye_error === 'No fault', 'all faults gone: alarm off');

  // warnings: notification only
  notifications.length = 0; fired.length = 0;
  await poll(device, [0, 0, 0, 0], [1 << 1, 0]);
  ok(device.caps.alarm_generic === false && notifications.length === 1 && notifications[0] === 'Deye: warning W02: Fan warning' && fired.length === 0, 'warning: notification only, no alarm, no trigger');
  await poll(device, [0, 0, 0, 0], [0, 0]);
  ok(notifications[1] === 'Deye: warning cleared - W02: Fan warning', 'warning cleared: notification');

  // a corrupt read changes nothing; a restart does not repeat the notification
  await poll(device, [0, 0, 1 << 2, 0]); notifications.length = 0; fired.length = 0;
  await poll(device, [0xFFFF, 0, 0, 0]);
  ok(device.caps.alarm_generic === true && notifications.length === 0 && fired.length === 0, 'corrupt read: nothing changes');
  const restarted = makeDevice(); restarted.store = JSON.parse(JSON.stringify(device.store)); restarted.caps = { ...device.caps };
  await poll(restarted, [0, 0, 1 << 2, 0]);
  ok(notifications.length === 0 && fired.length === 0, 'after a restart the active fault is not reported again');

  // missing registers (inverter rejected them): nothing happens
  const silent = makeDevice(); await silent.processAlarms({}); ok(!('alarm_generic' in silent.caps), 'registers not available: no capability added');

  // a failing notification does not block the rest
  const noNotifications = makeDevice(); noNotifications.homey.notifications.createNotification = async () => { throw new Error('boom'); }; noNotifications.error = () => {};
  fired.length = 0; await poll(noNotifications, [0, 0, 1 << 2, 0]);
  ok(noNotifications.caps.alarm_generic === true && fired.length === 1, 'failing notification: alarm and trigger still happen');

  // flow cards
  const fs = require('fs'); const path = require('path');
  const flowCards = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'drivers/deye/driver.flow.compose.json'), 'utf8'));
  const faultTriggers = flowCards.triggers.filter((card: any) => /^fault_/.test(card.id));
  ok(faultTriggers.length === 2 && faultTriggers.every((card: any) => card.tokens.map((token: any) => token.name).join() === 'code,description'), 'both fault triggers are declared with code and description tokens');

  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
})();
