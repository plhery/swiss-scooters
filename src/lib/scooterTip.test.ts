import { describe, expect, it } from 'vitest';
import type { TranslationKey } from '@/lib/i18n';
import { scooterTip } from '@/lib/scooterTip';

const english: Partial<Record<TranslationKey, string>> = {
  'tip.scooter': '{name} · {battery}% · {minutes} min',
  'tip.scooter.battery': '{name} · {battery}%',
  'tip.scooter.walk': '{name} · {minutes} min',
};
const i18n = {
  t: (key: TranslationKey, values: Record<string, string | number> = {}) => Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    english[key] ?? key
  ),
  formatNumber: (value: number) => String(value),
};

describe('scooterTip', () => {
  it('names the provider, the battery and the walk', () => {
    // 200 m at 80 m a minute, rounded up.
    expect(scooterTip({ provider: 'voi', battery: 64 }, 200, i18n)).toBe('Voi · 64% · 3 min');
  });

  it('leaves the walk out when there is nowhere to walk from', () => {
    expect(scooterTip({ provider: 'voi', battery: 64 }, null, i18n)).toBe('Voi · 64%');
  });

  it('leaves the battery out when the feed does not give it', () => {
    expect(scooterTip({ provider: 'hopp', battery: null }, 80, i18n)).toBe('Hopp · 1 min');
  });

  it('is the name alone when nothing else is known', () => {
    expect(scooterTip({ provider: 'lime', battery: null }, null, i18n)).toBe('Lime');
  });

  it('shows an empty battery as a number, not as unknown', () => {
    expect(scooterTip({ provider: 'bird', battery: 0 }, null, i18n)).toBe('Bird · 0%');
  });

  it('falls back to the key of a provider it does not know', () => {
    expect(scooterTip({ provider: 'newcomer', battery: 50 }, null, i18n)).toBe('newcomer · 50%');
  });
});
