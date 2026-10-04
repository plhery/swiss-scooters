import { describe, expect, it } from 'vitest';
import { clockOffset, failedRequestOutcome, isExpired, responseExpiry } from '@/lib/dataExpiry';
import type { ScooterResponseMeta } from '@/lib/types';

const T0 = Date.parse('2026-10-03T12:00:00.000Z');
const iso = (time: number) => new Date(time).toISOString();

function meta(overrides: Partial<ScooterResponseMeta> = {}): ScooterResponseMeta {
  return {
    generatedAt: iso(T0),
    partial: false,
    stale: false,
    failedSources: [],
    sources: {},
    truncated: false,
    totalVehicles: 0,
    mode: 'vehicles',
    zoom: 16,
    ...overrides,
  };
}

describe('responseExpiry', () => {
  it('uses the expiry the server sent', () => {
    expect(responseExpiry(meta({ expiresAt: iso(T0 + 120_000), parkingExpiresAt: iso(T0 + 60_000) }), T0 + 1_000))
      .toEqual({ vehicles: T0 + 120_000, parking: T0 + 60_000 });
  });

  it('accepts an expiry that is seconds away or already past', () => {
    expect(responseExpiry(meta({ generatedAt: iso(T0 - 297_000), expiresAt: iso(T0 + 3_000) }), T0).vehicles).toBe(T0 + 3_000);
    expect(responseExpiry(meta({ generatedAt: iso(T0 - 310_000), expiresAt: iso(T0 - 10_000) }), T0).vehicles).toBe(T0 - 10_000);
  });

  it('falls back to five minutes after the observation, three hours for the city overview', () => {
    expect(responseExpiry(meta({ generatedAt: iso(T0 - 60_000) }), T0)).toEqual({ vehicles: T0 + 240_000, parking: T0 + 300_000 });
    expect(responseExpiry(meta({ generatedAt: iso(T0 - 60_000), overview: true }), T0).vehicles).toBe(T0 - 60_000 + 3 * 3_600_000);
  });

  it('never trusts an expiry beyond the fallback, or a generation time in the future', () => {
    expect(responseExpiry(meta({ expiresAt: iso(T0 + 86_400_000) }), T0 + 5_000).vehicles).toBe(T0 + 300_000);
    expect(responseExpiry(meta({ generatedAt: iso(T0 + 600_000) }), T0).vehicles).toBe(T0 + 300_000);
    expect(responseExpiry(meta({ generatedAt: 'yesterday', expiresAt: 'soon' }), T0).vehicles).toBe(T0 + 300_000);
  });
});

describe('clockOffset', () => {
  it('is how far the device is ahead of the time the response was sent', () => {
    expect(clockOffset('Sat, 03 Oct 2026 12:00:00 GMT', T0 + 360_000)).toBe(360_000);
    expect(clockOffset('Sat, 03 Oct 2026 12:00:00 GMT', T0 - 120_000)).toBe(-120_000);
    expect(clockOffset('Sat, 03 Oct 2026 12:00:00 GMT', T0 + 800)).toBe(800);
  });

  it('is nothing without a header that can be read', () => {
    expect(clockOffset(null, T0)).toBe(0);
    expect(clockOffset('', T0)).toBe(0);
    expect(clockOffset('soon', T0)).toBe(0);
  });
});

describe('responseExpiry on a wrong device clock', () => {
  const fresh = meta({ generatedAt: iso(T0 - 20_000), expiresAt: iso(T0 + 280_000), parkingExpiresAt: iso(T0 + 100_000) });

  it('finds a fresh response expired on arrival when the clock is six minutes fast and nothing corrects it', () => {
    expect(isExpired(responseExpiry(fresh, T0 + 360_000).vehicles, T0 + 360_000)).toBe(true);
  });

  it('moves the server\'s times onto the device\'s clock', () => {
    expect(responseExpiry(fresh, T0 + 360_000, 360_000)).toEqual({ vehicles: T0 + 640_000, parking: T0 + 460_000 });
    expect(responseExpiry(fresh, T0 - 120_000, -120_000)).toEqual({ vehicles: T0 + 160_000, parking: T0 - 20_000 });
  });

  it('still caps the expiry at the fallback', () => {
    expect(responseExpiry(meta({ expiresAt: iso(T0 + 86_400_000) }), T0 + 360_000, 360_000).vehicles).toBe(T0 + 660_000);
  });
});

describe('isExpired', () => {
  it('expires at the deadline, not before, and never without one', () => {
    expect(isExpired(T0, T0 - 1)).toBe(false);
    expect(isExpired(T0, T0)).toBe(true);
    expect(isExpired(T0, T0 + 1)).toBe(true);
    expect(isExpired(null, T0)).toBe(false);
  });
});

describe('failedRequestOutcome', () => {
  it('keeps valid data when a refresh fails before the expiry', () => {
    expect(failedRequestOutcome({ hasData: true, expiresAt: T0 + 1 }, T0)).toBe('keep');
  });

  it('removes the data only when the request failing has finished after the expiry', () => {
    expect(failedRequestOutcome({ hasData: true, expiresAt: T0 }, T0)).toBe('out-of-date');
    expect(failedRequestOutcome({ hasData: true, expiresAt: T0 - 60_000 }, T0)).toBe('out-of-date');
  });

  it('has nothing to remove when a first load fails or the data is already gone', () => {
    expect(failedRequestOutcome({ hasData: false, expiresAt: null }, T0)).toBe('no-data');
    expect(failedRequestOutcome({ hasData: false, expiresAt: T0 - 60_000 }, T0)).toBe('no-data');
  });
});
