// Deye fault and warning codes (SG04LP3, Modbus protocol v1.04) and the decoding of the alarm registers.
//
//   553  Warning message word 1      554  Warning message word 2
//   555  Fault information word 1    556  word 2    557  word 3    558  word 4
//
// Sources: "MODBUS RTU V1.04" (registers, warning bits, fault table 5.5) and the SUN-5K-12K SG04LP3 manual
// (fault table 7-1). Codes without a description here are still reported, as "Unknown fault".
//
// VERIFY ON THE INVERTER: the protocol document only says "see the fault information coding table" for
// registers 555-558 and that table is not part of it. The mapping below assumes the usual layout, in which
// the four words hold the codes F01..F64 in order: code = 16 * (word - 1) + bit + 1
// (word 1 bit 0 = F01, word 1 bit 15 = F16, word 2 bit 0 = F17, ... word 4 bit 15 = F64).
// The same layout fits the warning words (W02 = bit 1, W03 = bit 2). If a real fault shows a different code
// on the inverter display than in Homey, adjust faultCodeForBit() only.

export interface AlarmItem {
  key: string;                       // stable key stored between polls: 'F35', 'W02', 'W2.14'
  kind: 'fault' | 'warning';
  code: string;                      // as shown to the user: 'F35'
  description: string;
  text: string;                      // 'F35: No AC grid'
}

export const FAULT_DESCRIPTIONS: Record<number, string> = {
  1: 'DC input polarity reverse fault',
  7: 'DC/DC soft start fault',
  10: 'Auxiliary power supply failure',
  13: 'Inverter work mode changed',
  15: 'AC over current fault (software)',
  16: 'AC leakage current fault',
  18: 'AC side over current fault (hardware)',
  20: 'DC side over current fault (hardware)',
  21: 'Tz_HV_Overcurr fault',
  22: 'Emergency stop fault (Tz_EmergStop), inverter locked',
  23: 'Leakage current fault (transient AC leakage over current)',
  24: 'DC insulation impedance failure (PV isolation resistance too low)',
  26: 'DC busbar unbalanced',
  29: 'Parallel CAN bus fault',
  34: 'AC over current fault',
  35: 'No AC grid',
  41: 'Parallel system stop',
  42: 'AC line low voltage (grid voltage fault)',
  46: 'Backup battery fault',
  47: 'AC over frequency',
  48: 'AC under frequency',
  49: 'Backup battery fault',
  55: 'DC busbar voltage too high',
  56: 'DC busbar voltage too low (battery voltage low)',
  58: 'BMS communication fault',
  62: 'DRM stop (DRM detection)',
  63: 'ARC fault',
  64: 'Heat sink high temperature failure',
};

interface WarningDefinition { word: 1 | 2; bit: number; code: string; description: string; }

/** Warning bits named in the protocol document (word 1 bit 0 is reserved). Other set bits are reported as unknown. */
export const WARNING_DEFINITIONS: WarningDefinition[] = [
  { word: 1, bit: 1, code: 'W02', description: 'Fan warning' },
  { word: 1, bit: 2, code: 'W03', description: 'Grid phase wrong' },
  { word: 1, bit: 3, code: 'W04', description: 'Meter communication failure' },   // W04 follows W03; the bit is not stated in the protocol document
  { word: 2, bit: 14, code: 'W2.14', description: 'Lithium battery lost' },
  { word: 2, bit: 15, code: 'W2.15', description: 'Parallel communication quality warning' },
];

const CORRUPT_WORD = 0xFFFF;          // a word with every bit set is a bad read, not 16 simultaneous alarms

export const formatFaultCode = (code: number) => `F${String(code).padStart(2, '0')}`;

/** Fault code of one bit in the fault words (see the note at the top: assumed layout). word is 1..4, bit is 0..15. */
export function faultCodeForBit(word: number, bit: number): number {
  return 16 * (word - 1) + bit + 1;
}

export function faultItem(code: number): AlarmItem {
  const description = FAULT_DESCRIPTIONS[code] ?? 'Unknown fault';
  const codeText = formatFaultCode(code);
  return { key: codeText, kind: 'fault', code: codeText, description, text: `${codeText}: ${description}` };
}

function warningItem(word: number, bit: number): AlarmItem {
  const known = WARNING_DEFINITIONS.find((definition) => definition.word === word && definition.bit === bit);
  const code = known ? known.code : `W${word}.${bit}`;
  const description = known ? known.description : 'Unknown warning';
  return { key: code, kind: 'warning', code, description, text: `${code}: ${description}` };
}

/** Rebuilds an item from its stored key (to describe an alarm that is no longer active). */
export function alarmItemFromKey(key: string): AlarmItem {
  const faultMatch = /^F(\d+)$/.exec(key);
  if (faultMatch) return faultItem(Number(faultMatch[1]));
  const warningMatch = /^W(\d)\.(\d+)$/.exec(key);
  if (warningMatch) return warningItem(Number(warningMatch[1]), Number(warningMatch[2]));
  const known = WARNING_DEFINITIONS.find((definition) => definition.code === key);
  return known ? warningItem(known.word, known.bit) : { key, kind: 'warning', code: key, description: 'Unknown warning', text: `${key}: Unknown warning` };
}

/**
 * The active faults and warnings in the four fault words and two warning words (in register order).
 * Returns null when a word is missing or corrupt, so a bad read never raises or clears an alarm.
 */
export function decodeAlarms(faultWords: number[], warningWords: number[]): AlarmItem[] | null {
  const allWords = [...faultWords, ...warningWords];
  if (faultWords.length !== 4 || warningWords.length !== 2) return null;
  if (allWords.some((word) => !Number.isInteger(word) || word < 0 || word > CORRUPT_WORD || word === CORRUPT_WORD)) return null;

  const items: AlarmItem[] = [];
  faultWords.forEach((word, wordIndex) => {
    for (let bit = 0; bit < 16; bit++) {
      if (word & (1 << bit)) items.push(faultItem(faultCodeForBit(wordIndex + 1, bit)));
    }
  });
  warningWords.forEach((word, wordIndex) => {
    for (let bit = 0; bit < 16; bit++) {
      if (wordIndex === 0 && bit === 0) continue;       // reserved
      if (word & (1 << bit)) items.push(warningItem(wordIndex + 1, bit));
    }
  });
  return items;
}

/** Which alarms appeared and which disappeared compared with the previous poll (previousKeys = stored keys). */
export function diffAlarms(previousKeys: string[], current: AlarmItem[]): { raised: AlarmItem[]; cleared: AlarmItem[] } {
  const currentKeys = new Set(current.map((item) => item.key));
  return {
    raised: current.filter((item) => !previousKeys.includes(item.key)),
    cleared: previousKeys.filter((key) => !currentKeys.has(key)).map(alarmItemFromKey),
  };
}
