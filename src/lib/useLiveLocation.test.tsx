// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldAcceptLocation, useLiveLocation } from '@/lib/useLiveLocation';

function position(latitude: number, longitude: number, accuracy = 5): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: Date.now(),
    toJSON: () => ({}),
  };
}

function installGeolocation() {
  let currentSuccess: PositionCallback | null = null;
  let watchSuccess: PositionCallback | null = null;
  let currentError: PositionErrorCallback | null = null;
  let nextWatchId = 1;
  const clearWatch = vi.fn();
  const watchPosition = vi.fn((success: PositionCallback) => {
    watchSuccess = success;
    return nextWatchId++;
  });
  const getCurrentPosition = vi.fn((success: PositionCallback, error?: PositionErrorCallback | null) => {
    currentSuccess = success;
    currentError = error ?? null;
  });

  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { clearWatch, getCurrentPosition, watchPosition },
  });

  return {
    clearWatch,
    getCurrentPosition,
    watchPosition,
    succeedCurrent: (next: GeolocationPosition) => currentSuccess?.(next),
    failCurrent: (next: GeolocationPositionError) => currentError?.(next),
    updateWatch: (next: GeolocationPosition) => watchSuccess?.(next),
  };
}

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
});

describe('shouldAcceptLocation', () => {
  it('accepts meaningful movement or a substantially more accurate fix', () => {
    const current = { coordinates: [47.3769, 8.5417] as [number, number], accuracyM: 40 };
    expect(shouldAcceptLocation(current, {
      coordinates: [47.37691, 8.54171],
      accuracyM: 40,
    })).toBe(false);
    expect(shouldAcceptLocation(current, {
      coordinates: [47.378, 8.5417],
      accuracyM: 5,
    })).toBe(true);
    expect(shouldAcceptLocation(current, {
      coordinates: [47.37691, 8.54171],
      accuracyM: 10,
    })).toBe(true);
  });
});

describe('useLiveLocation', () => {
  it('gets a fresh fix on demand and applies filtered live updates', async () => {
    const geolocation = installGeolocation();
    const onLocated = vi.fn();
    const { result } = renderHook(() => useLiveLocation());

    act(() => result.current.locate(onLocated));
    expect(result.current.locating).toBe(true);
    expect(geolocation.getCurrentPosition).toHaveBeenCalledOnce();
    expect(geolocation.watchPosition).not.toHaveBeenCalled();

    act(() => geolocation.succeedCurrent(position(47.3769, 8.5417, 20)));
    expect(onLocated).toHaveBeenCalledWith([47.3769, 8.5417]);
    expect(result.current.location).toEqual([47.3769, 8.5417]);
    await waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalledOnce());

    act(() => geolocation.updateWatch(position(47.37691, 8.54171, 20)));
    expect(result.current.location).toEqual([47.3769, 8.5417]);

    act(() => geolocation.updateWatch(position(47.378, 8.5417, 5)));
    expect(result.current.location).toEqual([47.378, 8.5417]);
  });

  it('pauses the watch while hidden and cleans it up on unmount', async () => {
    const geolocation = installGeolocation();
    const { result, unmount } = renderHook(() => useLiveLocation());

    act(() => result.current.locate(() => {}));
    act(() => geolocation.succeedCurrent(position(47.3769, 8.5417)));
    await waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalledOnce());

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(geolocation.clearWatch).toHaveBeenCalledWith(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(geolocation.watchPosition).toHaveBeenCalledTimes(2);

    unmount();
    expect(geolocation.clearWatch).toHaveBeenCalledWith(2);
  });

  it('distinguishes denied and temporarily unavailable positions', () => {
    const geolocation = installGeolocation();
    const { result } = renderHook(() => useLiveLocation());

    act(() => result.current.locate(() => {}));
    act(() => geolocation.failCurrent({
      code: 2,
      message: 'Unavailable',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    }));
    expect(result.current.error).toBe('unavailable');

    act(() => result.current.locate(() => {}));
    act(() => geolocation.failCurrent({
      code: 1,
      message: 'Denied',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    }));
    expect(result.current.error).toBe('denied');
  });
});
