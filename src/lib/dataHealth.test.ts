import { describe, expect, it } from 'vitest';
import { scooterDataHealthNotice } from '@/lib/dataHealth';

describe('scooterDataHealthNotice', () => {
  it('returns no notice for a complete fresh response', () => {
    expect(scooterDataHealthNotice({
      partial: false,
      stale: false,
      failedSources: [],
      sources: { national: 'fresh', hopp: 'fresh' },
      generatedAt: '2026-08-05T12:00:00.000Z',
      truncated: false,
      totalVehicles: 12,
    }, 12)).toBeNull();
  });

  it('combines stale, partial, and truncation warnings', () => {
    const format = (value: number) => value.toLocaleString();
    expect(scooterDataHealthNotice({
      partial: true,
      stale: true,
      failedSources: ['hopp'],
      sources: { national: 'stale', hopp: 'failed' },
      generatedAt: '2026-08-05T12:00:00.000Z',
      truncated: true,
      totalVehicles: 6_200,
    }, 5_000)).toBe([
      'Showing cached data',
      'Some providers unavailable',
      `Showing ${format(5_000)} of ${format(6_200)} results`,
    ].join(' · '));
  });
});
