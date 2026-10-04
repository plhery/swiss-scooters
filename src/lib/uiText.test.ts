import { describe, expect, it } from 'vitest';
import type { TranslationKey } from '@/lib/i18n';
import { formatClockTime, formatUiText, type UiTextFormatter } from '@/lib/uiText';

// Echoes the key and its values, so the test shows what reaches the dictionary.
const i18n: UiTextFormatter = {
  locale: 'de',
  t: (key: TranslationKey, values = {}) =>
    [key, ...Object.entries(values).map(([name, value]) => `${name}=${value}`)].join(' '),
  formatNumber: value => new Intl.NumberFormat('de-CH').format(value),
};

// Built in local time, so the expectations hold in any time zone.
const AT = new Date(2026, 9, 3, 14, 2).getTime();

describe('formatClockTime', () => {
  it('shows hours and minutes on the 24-hour clock in every app language', () => {
    for (const locale of ['de', 'fr', 'it', 'en'] as const) {
      expect(formatClockTime(AT, locale)).toBe('14:02');
    }
    expect(formatClockTime(new Date(2026, 9, 3, 7, 5).getTime(), 'en')).toBe('07:05');
  });
});

describe('formatUiText', () => {
  it('passes a plain key through', () => {
    expect(formatUiText({ key: 'dock.live' }, i18n)).toBe('dock.live');
  });

  it('substitutes names as they are', () => {
    expect(formatUiText({ key: 'dock.down.two', values: { first: 'Bird', second: 'Dott' } }, i18n))
      .toBe('dock.down.two first=Bird second=Dott');
  });

  it('formats numbers for the locale', () => {
    const grouped = new Intl.NumberFormat('de-CH').format(5412);
    expect(grouped).not.toBe('5412');
    expect(formatUiText({ key: 'dock.truncated', numbers: { shown: 2000, total: 5412 } }, i18n))
      .toBe(`dock.truncated shown=${new Intl.NumberFormat('de-CH').format(2000)} total=${grouped}`);
  });

  it('turns the time into a clock time', () => {
    expect(formatUiText({ key: 'dock.refreshFailed', time: AT }, i18n)).toBe('dock.refreshFailed time=14:02');
  });
});
