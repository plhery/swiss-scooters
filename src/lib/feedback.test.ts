// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('selection feedback', () => {
  it('keeps repeated selections short and rate-limited', async () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const time = vi.spyOn(performance, 'now').mockReturnValue(100);
    const { selectionFeedback } = await import('./feedback');
    selectionFeedback();
    selectionFeedback();
    expect(vibrate).toHaveBeenCalledExactlyOnceWith(8);
    time.mockReturnValue(180);
    selectionFeedback();
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('respects reduced motion', async () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { selectionFeedback } = await import('./feedback');
    selectionFeedback();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does not interrupt an interaction on unsupported or restricted browsers', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { selectionFeedback } = await import('./feedback');
    expect(selectionFeedback).not.toThrow();
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('Vibration is restricted');
      },
    });
    expect(selectionFeedback).not.toThrow();
  });
});
