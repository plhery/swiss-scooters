import { describe, expect, it } from 'vitest';
import { formatDistance, walkEstimate, walkingMinutes } from '@/lib/walking';

describe('walkingMinutes', () => {
  it('rounds up at eighty metres a minute and never says zero', () => {
    expect(walkingMinutes(0)).toBe(1);
    expect(walkingMinutes(80)).toBe(1);
    expect(walkingMinutes(81)).toBe(2);
    expect(walkingMinutes(320)).toBe(4);
    expect(walkingMinutes(1000)).toBe(13);
  });
});

describe('walkEstimate', () => {
  it('has nothing to say without an origin', () => {
    expect(walkEstimate(null, 47.3769, 8.5417)).toBeNull();
  });

  it('measures from your location', () => {
    const walk = walkEstimate({ point: [47.3769, 8.5417], place: null }, 47.3779, 8.5417);
    expect(walk?.place).toBeNull();
    expect(walk?.distanceM).toBeCloseTo(111.2, 0);
  });

  it('carries the name of a searched place', () => {
    expect(walkEstimate({ point: [47.3779, 8.5403], place: 'Zürich HB' }, 47.3779, 8.5403))
      .toEqual({ distanceM: 0, place: 'Zürich HB' });
  });
});

describe('formatDistance', () => {
  const formatter = {
    t: (key: string, values?: Record<string, string | number>) => `${values?.count} ${key === 'distance.meters' ? 'm' : 'km'}`,
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat('en-CH', options).format(value),
  };

  it('shows whole metres below a kilometre', () => {
    expect(formatDistance(126.4, formatter)).toBe('126 m');
    expect(formatDistance(999.4, formatter)).toBe('999 m');
  });

  it('shows kilometres from there, with a decimal only when it says something', () => {
    expect(formatDistance(1000, formatter)).toBe('1 km');
    expect(formatDistance(1449, formatter)).toBe('1.4 km');
    expect(formatDistance(24_000, formatter)).toBe('24 km');
  });
});
