import { describe, expect, it } from 'vitest';
import { failedRequestOutcome, isExpired, responseExpiry } from '@/lib/dataExpiry';
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
