// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nearestHeading, readDeviceHeading, requestHeadingPermission } from './deviceHeading';
import { useDeviceHeading } from './useDeviceHeading';

const relative = { alpha: 20, beta: 0, gamma: 0, absolute: false };
const absolute = { ...relative, absolute: true };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('phone heading', () => {
  it('uses Safari compass readings, including landscape orientation', () => {
    const event = { ...relative, webkitCompassHeading: 270, webkitCompassAccuracy: 8 };
    expect(readDeviceHeading(event)).toEqual({ degrees: 270, accuracy: 8 });
    expect(readDeviceHeading(event, 90)?.degrees).toBe(0);
    expect(readDeviceHeading({ ...event, webkitCompassAccuracy: -1 })).toBeNull();
    expect(readDeviceHeading({ ...event, webkitCompassHeading: -1 })).toBeNull();
    expect(readDeviceHeading({ ...event, webkitCompassAccuracy: 90 })).toBeNull();
  });

  it('requires north-referenced orientation and projects flat, tilted and upright phones', () => {
    expect(readDeviceHeading(relative)).toBeNull();
    expect(readDeviceHeading({ ...absolute, alpha: null })).toBeNull();
    expect(readDeviceHeading({ ...absolute, alpha: NaN })).toBeNull();
    expect(readDeviceHeading({ ...absolute, alpha: 90 })?.degrees).toBeCloseTo(270);
    expect(readDeviceHeading({ ...absolute, alpha: 90 }, 90)?.degrees).toBeCloseTo(0);
    expect(readDeviceHeading({ ...absolute, alpha: 270, beta: 45 })?.degrees).toBeCloseTo(90);
    expect(readDeviceHeading({ ...absolute, alpha: 270, beta: 90 })?.degrees).toBeCloseTo(90);
  });

  it('crosses north without spinning the beam around', () => {
    expect(nearestHeading(359, 1)).toBe(361);
    expect(nearestHeading(1, 359)).toBe(-1);
    expect(nearestHeading(721, 359)).toBe(719);
  });

  it('requests compass permission immediately, while user activation is still available', async () => {
    const requestPermission = vi.fn(async () => 'granted');
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission });
    const pending = requestHeadingPermission();
    expect(requestPermission).toHaveBeenCalledWith(true);
    await expect(pending).resolves.toBe('granted');
  });

  it('handles denied, unavailable and rejected sensor access', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission: async () => 'denied' });
    await expect(requestHeadingPermission()).resolves.toBe('denied');
    vi.stubGlobal('DeviceOrientationEvent', { requestPermission: async () => { throw new Error('Blocked'); } });
    await expect(requestHeadingPermission()).resolves.toBe('denied');
    vi.stubGlobal('DeviceOrientationEvent', undefined);
    await expect(requestHeadingPermission()).resolves.toBe('unavailable');
  });
});

describe('live heading lifecycle', () => {
  function send(reading: object, type = 'deviceorientation') {
    window.dispatchEvent(Object.assign(new Event(type), reading));
  }

  it('batches sensor updates, ignores relative events and discards uncalibrated headings', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDeviceHeading(true));
    act(() => {
      send({ ...absolute, alpha: 180 }, 'deviceorientationabsolute');
      send({ ...absolute, alpha: 270 }, 'deviceorientationabsolute');
      send(relative);
      vi.advanceTimersByTime(100);
    });
    expect(result.current?.degrees).toBeCloseTo(90);
    act(() => {
      send({ ...relative, webkitCompassHeading: 90, webkitCompassAccuracy: -1 });
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBeNull();
  });

  it('pauses while hidden and requires fresh readings after resuming or re-enabling', () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(({ active }) => useDeviceHeading(active), { initialProps: { active: true } });
    const reading = { ...relative, webkitCompassHeading: 45, webkitCompassAccuracy: 5 };
    act(() => { send(reading); vi.advanceTimersByTime(100); });
    expect(result.current?.degrees).toBe(45);
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      send(reading); vi.advanceTimersByTime(100);
    });
    expect(result.current).toBeNull();
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBeNull();
    act(() => { send(reading); vi.advanceTimersByTime(100); });
    expect(result.current?.degrees).toBe(45);
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current).toBeNull();
    unmount();
    act(() => { send(reading); });
    expect(vi.getTimerCount()).toBe(0);
  });
});
