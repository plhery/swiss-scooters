import { describe, expect, it } from 'vitest';
import {
  MAX_LATITUDE_SPAN,
  MAX_LONGITUDE_SPAN,
  parseScooterQuery,
} from '@/lib/scooterQuery';

describe('parseScooterQuery', () => {
  it('parses valid bounds and known providers', () => {
    const result = parseScooterQuery(new URLSearchParams({
      lat: '47.3769',
      lng: '8.5417',
      south: '47.36',
      west: '8.52',
      north: '47.39',
      east: '8.57',
      minBattery: '25',
      provider: 'lime, dott',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.minBattery).toBe(25);
    expect(result.query.providers).toEqual(new Set(['lime', 'dott']));
  });

  it('rejects world-sized requests with a zoom-in message', () => {
    const result = parseScooterQuery(new URLSearchParams({
      south: String(-MAX_LATITUDE_SPAN),
      north: String(MAX_LATITUDE_SPAN),
      west: String(-MAX_LONGITUDE_SPAN),
      east: String(MAX_LONGITUDE_SPAN),
    }));

    expect(result).toEqual({
      ok: false,
      error: 'Map area is too large. Zoom in to load scooters.',
    });
  });

  it('rejects unknown providers and non-integer battery values', () => {
    expect(parseScooterQuery(new URLSearchParams({ provider: 'unknown' }))).toEqual({
      ok: false,
      error: 'Unknown scooter provider',
    });
    expect(parseScooterQuery(new URLSearchParams({ minBattery: '25.5' }))).toEqual({
      ok: false,
      error: 'Invalid scooter search parameters',
    });
    expect(parseScooterQuery(new URLSearchParams({ lat: '' }))).toEqual({
      ok: false,
      error: 'Invalid scooter search parameters',
    });
  });
});
