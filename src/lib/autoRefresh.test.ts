import { describe, expect, it } from 'vitest';
import {
  EXPIRY_LEAD_MS,
  MIN_ATTEMPT_GAP_MS,
  nextRefreshAt,
  refreshDecision,
  refreshDueAt,
  type RefreshContext,
  type RefreshSchedule,
} from '@/lib/autoRefresh';

const T0 = 1_000_000;

// Received at T0 with the usual five minutes of validity left.
const healthy: RefreshSchedule = {
  lastSuccessAt: T0,
  lastAttemptAt: T0,
  refreshAfterMs: 60_000,
  expiresAt: T0 + 300_000,
};

function context(overrides: Partial<RefreshContext> = {}): RefreshContext {
  return { ...healthy, now: T0, visible: true, requestInFlight: false, hasQuery: true, ...overrides };
}

describe('nextRefreshAt', () => {
  it('follows the server interval while the data stays valid for longer', () => {
    expect(nextRefreshAt(healthy)).toBe(T0 + 60_000);
    expect(nextRefreshAt({ ...healthy, refreshAfterMs: 3_600_000, expiresAt: T0 + 3 * 3_600_000 }))
      .toBe(T0 + 3_600_000);
  });

  it('refreshes five seconds before the data expires when that comes first', () => {
    expect(nextRefreshAt({ ...healthy, expiresAt: T0 + 40_000 })).toBe(T0 + 40_000 - EXPIRY_LEAD_MS);
  });

  it('leaves ten seconds after the previous request, also for data that expires within seconds', () => {
    expect(nextRefreshAt({ ...healthy, expiresAt: T0 + 8_000 })).toBe(T0 + MIN_ATTEMPT_GAP_MS);
    expect(nextRefreshAt({ ...healthy, expiresAt: T0 + 14_999 })).toBe(T0 + MIN_ATTEMPT_GAP_MS);
    expect(nextRefreshAt({ ...healthy, expiresAt: T0 + 15_001 })).toBe(T0 + 10_001);
  });

  it('treats a snapshot that arrived already expired like any other: again after the gap', () => {
    expect(nextRefreshAt({ ...healthy, expiresAt: T0 - 30_000 })).toBe(T0 + MIN_ATTEMPT_GAP_MS);
  });

  it('retries a failed refresh ten seconds after it finished', () => {
    // The scheduled refresh at T0 + 60 s failed two seconds later.
    expect(nextRefreshAt({ ...healthy, lastAttemptAt: T0 + 62_000 })).toBe(T0 + 72_000);
    // And keeps doing so once the data has expired.
    expect(nextRefreshAt({ ...healthy, lastAttemptAt: T0 + 400_000 })).toBe(T0 + 410_000);
  });

  it('does not bring the schedule forward for a request that failed ahead of it', () => {
    expect(nextRefreshAt({ ...healthy, lastAttemptAt: T0 + 20_000 })).toBe(T0 + 60_000);
  });

  it('retries a failed first load after the gap', () => {
    expect(nextRefreshAt({ ...healthy, lastSuccessAt: null, expiresAt: null, lastAttemptAt: T0 })).toBe(T0 + MIN_ATTEMPT_GAP_MS);
  });

  it('has nothing to schedule before the first request has finished', () => {
    expect(nextRefreshAt({ ...healthy, lastSuccessAt: null, lastAttemptAt: null, expiresAt: null })).toBeNull();
  });

  it('never polls faster than the gap, whatever interval the server names', () => {
    expect(nextRefreshAt({ ...healthy, refreshAfterMs: 0 })).toBe(T0 + MIN_ATTEMPT_GAP_MS);
    expect(nextRefreshAt({ ...healthy, refreshAfterMs: 1_000 })).toBe(T0 + MIN_ATTEMPT_GAP_MS);
  });

  it('uses the interval alone when the data has no expiry', () => {
    expect(nextRefreshAt({ ...healthy, expiresAt: null })).toBe(T0 + 60_000);
  });
});

describe('refreshDueAt', () => {
  it('is the schedule without the gap between requests', () => {
    expect(refreshDueAt(healthy)).toBe(T0 + 60_000);
    expect(refreshDueAt({ ...healthy, expiresAt: T0 + 8_000 })).toBe(T0 + 3_000);
    expect(refreshDueAt({ ...healthy, lastSuccessAt: null })).toBe(-Infinity);
  });
});

describe('refreshDecision', () => {
  it('waits until the refresh is due, then refreshes', () => {
    expect(refreshDecision(context({ now: T0 + 59_999 }))).toEqual({ action: 'wait', at: T0 + 60_000 });
    expect(refreshDecision(context({ now: T0 + 60_000 }))).toEqual({ action: 'refresh' });
  });

  it('starts a request when the data expires and none is running', () => {
    // The refresh before expiry failed at T0 + 293 s; the data expires at T0 + 300 s.
    const afterFailure = context({ lastAttemptAt: T0 + 293_000 });
    expect(refreshDecision({ ...afterFailure, now: T0 + 300_000 })).toEqual({ action: 'wait', at: T0 + 303_000 });
    expect(refreshDecision({ ...afterFailure, now: T0 + 303_000 })).toEqual({ action: 'refresh' });
  });

  it('waits for a request that is already running, also across the expiry', () => {
    expect(refreshDecision(context({ now: T0 + 60_000, requestInFlight: true }))).toEqual({ action: 'wait', at: null });
    expect(refreshDecision(context({ now: T0 + 301_000, requestInFlight: true }))).toEqual({ action: 'wait', at: null });
  });

  it('never refreshes while the page is hidden, even when the data has expired', () => {
    expect(refreshDecision(context({ now: T0 + 60_000, visible: false }))).toEqual({ action: 'wait', at: null });
    expect(refreshDecision(context({ now: T0 + 3_600_000, visible: false }))).toEqual({ action: 'wait', at: null });
  });

  it('refreshes at once on return to the foreground when a refresh is due or the data expired', () => {
    expect(refreshDecision(context({ now: T0 + 90_000, returning: true }))).toEqual({ action: 'refresh' });
    expect(refreshDecision(context({ now: T0 + 3_600_000, returning: true }))).toEqual({ action: 'refresh' });
  });

  it('does not wait out the gap on return to the foreground', () => {
    // A retry failed three seconds before the page came back.
    const failedRecently = context({ lastAttemptAt: T0 + 87_000, now: T0 + 90_000 });
    expect(refreshDecision(failedRecently)).toEqual({ action: 'wait', at: T0 + 97_000 });
    expect(refreshDecision({ ...failedRecently, returning: true })).toEqual({ action: 'refresh' });
  });

  it('keeps fresh data on return to the foreground and resumes the schedule', () => {
    expect(refreshDecision(context({ now: T0 + 20_000, returning: true }))).toEqual({ action: 'wait', at: T0 + 60_000 });
  });

  it('does nothing before the map has reported a viewport or a first request has finished', () => {
    expect(refreshDecision(context({ hasQuery: false, now: T0 + 60_000 }))).toEqual({ action: 'wait', at: null });
    expect(refreshDecision(context({ lastSuccessAt: null, lastAttemptAt: null, expiresAt: null, returning: true })))
      .toEqual({ action: 'wait', at: null });
  });

  it('retries a failed first load every ten seconds while visible', () => {
    const failed = context({ lastSuccessAt: null, expiresAt: null, lastAttemptAt: T0 });
    expect(refreshDecision({ ...failed, now: T0 + 9_999 })).toEqual({ action: 'wait', at: T0 + 10_000 });
    expect(refreshDecision({ ...failed, now: T0 + 10_000 })).toEqual({ action: 'refresh' });
    expect(refreshDecision({ ...failed, now: T0 + 10_000, visible: false })).toEqual({ action: 'wait', at: null });
  });
});
