import { describe, expect, it } from 'vitest';
import { shouldAutoRefresh } from '@/lib/autoRefresh';

const ready = {
  visible: true,
  requestInFlight: false,
  hasBounds: true,
  lastUpdatedAt: 1_000,
  now: 61_000,
  intervalMs: 60_000,
};

describe('shouldAutoRefresh', () => {
  it('refreshes stale visible data and first-load data', () => {
    expect(shouldAutoRefresh(ready)).toBe(true);
    expect(shouldAutoRefresh({ ...ready, lastUpdatedAt: null })).toBe(true);
  });

  it('pauses while hidden, loading, uninitialized, or still fresh', () => {
    expect(shouldAutoRefresh({ ...ready, visible: false })).toBe(false);
    expect(shouldAutoRefresh({ ...ready, requestInFlight: true })).toBe(false);
    expect(shouldAutoRefresh({ ...ready, hasBounds: false })).toBe(false);
    expect(shouldAutoRefresh({ ...ready, now: 60_999 })).toBe(false);
  });
});
