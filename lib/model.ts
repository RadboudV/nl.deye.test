/**
 * Inverter model name, built from the device identification registers of the
 * Deye protocol (V1.04):
 *   register 0   device type   0x0005 three phase low voltage hybrid
 *                              0x0006 three phase high voltage hybrid
 *                              0x0300 single phase low voltage hybrid
 *   register 28  generation    1 = SG01, 2 = SG02, 4 = SG04 ...
 *
 * An SG04LP3 therefore reads as generation 4 + device type 0x0005 (LP3 = low
 * voltage, 3 phase). Returns null while a register is missing, so the setting
 * keeps its previous value.
 */
const TYPE_SUFFIX: Record<number, string> = {
  0x0005: 'LP3',
  0x0006: 'HP3',
  0x0300: 'LP1',
};

export function inverterModel(deviceType: unknown, generation: unknown): string | null {
  const typeCode = Number(deviceType);
  const generationNumber = Number(generation);
  if (deviceType === undefined || generation === undefined) return null;
  if (!Number.isInteger(typeCode) || !Number.isInteger(generationNumber)) return null;

  const suffix = TYPE_SUFFIX[typeCode];
  if (!suffix) return `Unknown device type 0x${typeCode.toString(16).padStart(4, '0')}`;
  if (generationNumber < 1 || generationNumber > 99) return suffix;
  return `SG${String(generationNumber).padStart(2, '0')}${suffix}`;
}
