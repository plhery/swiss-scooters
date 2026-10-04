import { describe, expect, it } from 'vitest';
import { BATTERY_PRESETS, batteryLevel, batteryPresetLabel, snapBatteryPreset } from '@/lib/battery';

describe('battery presets', () => {
  it('offers any, 30, 60 and 80 percent', () => {
    expect(BATTERY_PRESETS).toEqual([0, 30, 60, 80]);
  });

  it('keeps a preset as it is', () => {
    for (const preset of BATTERY_PRESETS) expect(snapBatteryPreset(preset)).toBe(preset);
  });

  it('snaps other values down, never up', () => {
    expect(snapBatteryPreset(45)).toBe(30);
    expect(snapBatteryPreset(95)).toBe(80);
    expect(snapBatteryPreset(100)).toBe(80);
    expect(snapBatteryPreset(79.9)).toBe(60);
    expect(snapBatteryPreset(59)).toBe(30);
    expect(snapBatteryPreset(29)).toBe(0);
    expect(snapBatteryPreset(5)).toBe(0);
  });

  it('treats values outside the range and non-numbers as the nearest end', () => {
    expect(snapBatteryPreset(-20)).toBe(0);
    expect(snapBatteryPreset(250)).toBe(80);
    expect(snapBatteryPreset(Infinity)).toBe(80);
    expect(snapBatteryPreset(NaN)).toBe(0);
  });

  it('labels the minimums the same in every language', () => {
    expect(BATTERY_PRESETS.map(batteryPresetLabel)).toEqual([null, '30%+', '60%+', '80%+']);
  });
});

describe('batteryLevel', () => {
  it('is good from 50, low from 20 to 49 and critical below 20', () => {
    expect(batteryLevel(100)).toBe('good');
    expect(batteryLevel(50)).toBe('good');
    expect(batteryLevel(49)).toBe('low');
    expect(batteryLevel(20)).toBe('low');
    expect(batteryLevel(19)).toBe('critical');
    expect(batteryLevel(0)).toBe('critical');
  });
});
