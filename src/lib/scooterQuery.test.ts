import { describe, expect, it } from 'vitest';
import { SWISS_MOBILITY_BOUNDS } from '@/lib/feedCoverage';
import { parseScooterQuery } from '@/lib/scooterQuery';

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
      zoom: '15',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.origin).toEqual([47.3769, 8.5417]);
    expect(result.query.minBattery).toBe(25);
    expect(result.query.providers).toEqual(new Set(['lime', 'dott']));
    expect(result.zoom).toBe(15);
  });

  it('clamps world-sized requests to the Swiss service envelope', () => {
    const result = parseScooterQuery(new URLSearchParams({
      south: '-90',
      north: '90',
      west: '-180',
      east: '180',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.bounds).toEqual(SWISS_MOBILITY_BOUNDS);
    expect(result.query.outsideCoverage).toBe(false);
    expect(result.query.origin).toBeNull();
  });

  it('marks views outside Switzerland so feeds can be skipped', () => {
    const result = parseScooterQuery(new URLSearchParams({
      lat: '48.86',
      lng: '2.35',
      south: '48.80',
      north: '48.92',
      west: '2.25',
      east: '2.45',
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.outsideCoverage).toBe(true);
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
    expect(parseScooterQuery(new URLSearchParams({ lat: '47.3' }))).toEqual({
      ok: false,
      error: 'Invalid scooter search parameters',
    });
    expect(parseScooterQuery(new URLSearchParams({ zoom: '15.5' }))).toEqual({
      ok: false,
      error: 'Invalid scooter search parameters',
    });
    expect(parseScooterQuery(new URLSearchParams({ zoom: '23' }))).toEqual({
      ok: false,
      error: 'Invalid scooter search parameters',
    });
  });
});
