import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RIDE_DURATION,
  RIDE_DURATIONS,
  RIDE_DURATION_STORAGE_KEY,
  formatRidePrice,
  loadRideDuration,
  normalizeRideDuration,
  ridePriceQuote,
  saveRideDuration,
} from '@/lib/ridePrice';

const LIME = { currency: 'CHF', unlock_fee_minor_units: 100, minute_fee_minor_units: 35 };

// Intl separates amount and currency with no-break spaces.
const plain = (text: string) => text.replace(/[  ]/g, ' ');

describe('ride durations', () => {
  it('allows 5, 10, 15, 20 and 30 minutes with 10 as the default', () => {
    expect(RIDE_DURATIONS).toEqual([5, 10, 15, 20, 30]);
    expect(DEFAULT_RIDE_DURATION).toBe(10);
  });

  it('falls back to the default for anything else', () => {
    for (const minutes of RIDE_DURATIONS) expect(normalizeRideDuration(minutes)).toBe(minutes);
    for (const other of [0, 7, 25, 60, -5, 10.5, NaN, '15', null, undefined]) {
      expect(normalizeRideDuration(other)).toBe(10);
    }
  });
});

describe('ridePriceQuote', () => {
  it('adds the unlock fee to the minutes ridden', () => {
    expect(ridePriceQuote(LIME, 10)).toEqual({
      currency: 'CHF',
      durationMinutes: 10,
      unlockFeeMinorUnits: 100,
      minuteFeeMinorUnits: 35,
      totalMinorUnits: 450,
    });
    expect(ridePriceQuote(LIME, 30).totalMinorUnits).toBe(1150);
    expect(ridePriceQuote(LIME, 0).totalMinorUnits).toBe(100);
  });

  it('handles tariffs without an unlock fee or without a minute fee', () => {
    expect(ridePriceQuote({ ...LIME, unlock_fee_minor_units: 0 }, 20).totalMinorUnits).toBe(700);
    expect(ridePriceQuote({ ...LIME, minute_fee_minor_units: 0 }, 20).totalMinorUnits).toBe(100);
  });

  it('never goes below zero for negative input, like the iOS estimator', () => {
    expect(ridePriceQuote({ currency: 'EUR', unlock_fee_minor_units: -100, minute_fee_minor_units: 25 }, 10).totalMinorUnits).toBe(250);
    expect(ridePriceQuote({ currency: 'EUR', unlock_fee_minor_units: 100, minute_fee_minor_units: -25 }, 10).totalMinorUnits).toBe(100);
    expect(ridePriceQuote(LIME, -10)).toMatchObject({ durationMinutes: 0, totalMinorUnits: 100 });
  });

  it('stays a safe whole number for absurd or broken tariffs', () => {
    expect(ridePriceQuote({ currency: 'CHF', unlock_fee_minor_units: 1, minute_fee_minor_units: Number.MAX_SAFE_INTEGER }, 30).totalMinorUnits)
      .toBe(Number.MAX_SAFE_INTEGER);
    expect(ridePriceQuote({ currency: 'CHF', unlock_fee_minor_units: NaN, minute_fee_minor_units: 35.9 }, 10).totalMinorUnits).toBe(350);
  });
});

describe('formatRidePrice', () => {
  it('formats Swiss francs and euros for each app language', () => {
    expect(plain(formatRidePrice(450, 'CHF', 'en'))).toBe('CHF 4.50');
    expect(plain(formatRidePrice(450, 'CHF', 'de'))).toBe('CHF 4.50');
    expect(plain(formatRidePrice(450, 'CHF', 'fr'))).toBe('4.50 CHF');
    expect(plain(formatRidePrice(450, 'CHF', 'it'))).toBe('CHF 4.50');
    expect(plain(formatRidePrice(325, 'EUR', 'fr'))).toBe('3.25 €');
    expect(plain(formatRidePrice(325, 'EUR', 'de'))).toBe('EUR 3.25');
  });

  it('always shows two decimals', () => {
    expect(plain(formatRidePrice(400, 'CHF', 'en'))).toBe('CHF 4.00');
    expect(plain(formatRidePrice(5, 'CHF', 'en'))).toBe('CHF 0.05');
    expect(plain(formatRidePrice(0, 'CHF', 'en'))).toBe('CHF 0.00');
  });

  it('accepts a lower-case code and survives one that is not a currency', () => {
    expect(plain(formatRidePrice(450, 'chf', 'en'))).toBe('CHF 4.50');
    expect(formatRidePrice(450, 'francs', 'en')).toBe('FRANCS 4.50');
  });
});

describe('stored ride duration', () => {
  beforeEach(() => localStorage.clear());

  it('starts with the default', () => {
    expect(loadRideDuration()).toBe(10);
  });

  it('remembers the chosen duration', () => {
    expect(saveRideDuration(20)).toBe(20);
    expect(localStorage.getItem(RIDE_DURATION_STORAGE_KEY)).toBe('20');
    expect(loadRideDuration()).toBe(20);
  });

  it('stores and restores only allowed durations', () => {
    expect(saveRideDuration(25)).toBe(10);
    expect(localStorage.getItem(RIDE_DURATION_STORAGE_KEY)).toBe('10');
    for (const stored of ['45', 'abc', '', '15.5', '{"minutes":15}']) {
      localStorage.setItem(RIDE_DURATION_STORAGE_KEY, stored);
      expect(loadRideDuration(), stored).toBe(10);
    }
  });

  it('works without storage', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadRideDuration()).toBe(10);
    expect(saveRideDuration(30)).toBe(30);
  });
});
