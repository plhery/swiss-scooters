import { afterEach, describe, expect, it, vi } from 'vitest';
import { statusObservedAt, validateStationStatus, validateVehicleStatus } from './feedValidation';

const now = Date.parse('2026-10-04T12:00:00Z');

afterEach(() => vi.restoreAllMocks());

describe('vehicle timestamp age', () => {
  it.each([5 * 60_000 + 1, 8 * 60_000, 10 * 60_000])('accepts a source timestamp %i ms old', age => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const updatedAt = now - age;
    const feed = { last_updated: updatedAt / 1000, data: { bikes: [] } };
    expect(() => validateVehicleStatus(feed)).not.toThrow();
    expect(statusObservedAt(feed)).toBe(updatedAt);
    expect(statusObservedAt({ last_updated: new Date(updatedAt).toISOString() })).toBe(updatedAt);
  });

  it.each([null, 'invalid', (now - 10 * 60_000 - 1) / 1000, (now + 5 * 60_000 + 1) / 1000])(
    'rejects missing, invalid, expired or excessively future timestamps: %s', last_updated => {
      expect(() => statusObservedAt({ last_updated }, now)).toThrow('Status timestamp is missing or out of date');
    },
  );

  it('keeps parking availability limited to five minutes', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(() => validateStationStatus({ last_updated: (now - 5 * 60_000) / 1000, data: { stations: [] } })).not.toThrow();
    expect(() => validateStationStatus({ last_updated: (now - 5 * 60_000 - 1) / 1000, data: { stations: [] } })).toThrow();
  });
});
