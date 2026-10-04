import { describe, expect, it } from 'vitest';
import { classifyLoadFailure, failureReasonKey, failureSurface } from '@/lib/loadFailure';

describe('classifyLoadFailure', () => {
  it('reads an HTTP error status', () => {
    expect(classifyLoadFailure({ status: 429 })).toBe('busy');
    expect(classifyLoadFailure({ status: 500 })).toBe('unavailable');
    expect(classifyLoadFailure({ status: 503 })).toBe('unavailable');
    expect(classifyLoadFailure({ status: 599 })).toBe('unavailable');
    expect(classifyLoadFailure({ status: 400 })).toBe('failed');
    expect(classifyLoadFailure({ status: 404 })).toBe('failed');
    expect(classifyLoadFailure({ status: 600 })).toBe('failed');
  });

  it('trusts the answer of the server over the connection state', () => {
    expect(classifyLoadFailure({ status: 503, online: false })).toBe('unavailable');
    expect(classifyLoadFailure({ status: 429, timedOut: true })).toBe('busy');
  });

  it('tells a request that never got an answer apart by connection and deadline', () => {
    expect(classifyLoadFailure({ online: false })).toBe('offline');
    expect(classifyLoadFailure({ online: false, timedOut: true })).toBe('offline');
    expect(classifyLoadFailure({ online: true, timedOut: true })).toBe('timeout');
    expect(classifyLoadFailure({ timedOut: true })).toBe('timeout');
    expect(classifyLoadFailure({ online: true })).toBe('failed');
    expect(classifyLoadFailure({})).toBe('failed');
  });
});

describe('failureReasonKey', () => {
  it('has one sentence per reason', () => {
    expect(failureReasonKey('offline')).toBe('fail.offline');
    expect(failureReasonKey('timeout')).toBe('fail.timeout');
    expect(failureReasonKey('busy')).toBe('fail.busy');
    expect(failureReasonKey('unavailable')).toBe('fail.unavailable');
    expect(failureReasonKey('failed')).toBe('fail.generic');
  });
});

describe('failureSurface', () => {
  it('shows nothing while nothing is wrong', () => {
    expect(failureSurface({ failure: null, hasData: true, outOfDate: false })).toBeNull();
    expect(failureSurface({ failure: null, hasData: false, outOfDate: false })).toBeNull();
  });

  it('uses the banner for a failed first load', () => {
    expect(failureSurface({ failure: 'offline', hasData: false, outOfDate: false })).toBe('banner');
  });

  it('uses the dock status line while the data on screen is still valid', () => {
    expect(failureSurface({ failure: 'timeout', hasData: true, outOfDate: false })).toBe('status');
  });

  it('uses the card once the data was removed', () => {
    expect(failureSurface({ failure: 'offline', hasData: false, outOfDate: true })).toBe('card');
  });
});
