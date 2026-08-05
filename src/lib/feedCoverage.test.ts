import { describe, expect, it } from 'vitest';
import {
  coverageForRegionNames,
  coverageIntersects,
  knownSystemCoverage,
} from '@/lib/feedCoverage';

describe('feed coverage routing', () => {
  const zurich = { south: 47.36, west: 8.52, north: 47.39, east: 8.57 };
  const basel = { south: 47.54, west: 7.56, north: 47.59, east: 7.63 };

  it('extracts city coverage from provider system IDs', () => {
    const limeZurich = knownSystemCoverage('lime_zurich');
    const birdBasel = knownSystemCoverage('bird-basel');

    expect(limeZurich).not.toBeNull();
    expect(birdBasel).not.toBeNull();
    expect(coverageIntersects(limeZurich ?? [], zurich)).toBe(true);
    expect(coverageIntersects(limeZurich ?? [], basel)).toBe(false);
    expect(coverageIntersects(birdBasel ?? [], basel)).toBe(true);
  });

  it('leaves national and unbounded systems for dynamic coverage resolution', () => {
    expect(knownSystemCoverage('voiscooters.com')).toBeNull();
    expect(knownSystemCoverage('publibike')).toBeNull();
    expect(knownSystemCoverage('lime_new-city')).toBeNull();
  });

  it('routes Velospot only to its current scooter areas', () => {
    const velospot = knownSystemCoverage('velospot');

    expect(velospot).not.toBeNull();
    expect(coverageIntersects(velospot ?? [], {
      south: 46.14,
      west: 8.73,
      north: 46.20,
      east: 8.85,
    })).toBe(true);
    expect(coverageIntersects(velospot ?? [], zurich)).toBe(false);
  });

  it('normalizes translated and compound region names', () => {
    const coverage = coverageForRegionNames([
      'Zürich',
      'Biel/Bienne',
      'Illnau-Effretikon',
    ]);

    expect(coverage.complete).toBe(true);
    expect(coverage.bounds).toHaveLength(3);
    expect(coverageIntersects(coverage.bounds, zurich)).toBe(true);
  });

  it('marks unknown regions incomplete so callers can use the spatial fallback', () => {
    const coverage = coverageForRegionNames(['Bern', 'New Region']);

    expect(coverage.complete).toBe(false);
    expect(coverage.bounds).toHaveLength(1);
  });
});
