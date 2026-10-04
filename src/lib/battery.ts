/** The minimum-battery choices of the filter. 0 is "Any". */
export const BATTERY_PRESETS = [0, 30, 60, 80] as const;
export type BatteryPreset = (typeof BATTERY_PRESETS)[number];

/** The highest preset the value reaches, so a stored 45 keeps showing everything from 30. */
export function snapBatteryPreset(value: number): BatteryPreset {
  let snapped: BatteryPreset = 0;
  for (const preset of BATTERY_PRESETS) {
    if (value >= preset) snapped = preset;
  }
  return snapped;
}

/** "30%+", the same in every language. Null for 0, which reads as the translated "Any". */
export function batteryPresetLabel(preset: BatteryPreset): string | null {
  return preset === 0 ? null : `${preset}%+`;
}

/** Green, amber and red on both platforms. */
export type BatteryLevel = 'good' | 'low' | 'critical';

export function batteryLevel(percent: number): BatteryLevel {
  if (percent >= 50) return 'good';
  return percent >= 20 ? 'low' : 'critical';
}
