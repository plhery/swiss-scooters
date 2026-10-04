// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { RIDE_DURATION_STORAGE_KEY } from '@/lib/ridePrice';

// The hook reads storage once per page load, so each test loads the module anew.
async function loadHook() {
  vi.resetModules();
  return (await import('@/lib/useRideDuration')).useRideDuration;
}

beforeEach(() => localStorage.clear());

it('starts with ten minutes', async () => {
  const useRideDuration = await loadHook();
  const { result } = renderHook(() => useRideDuration());
  expect(result.current[0]).toBe(10);
});

it('restores the duration chosen earlier on this device', async () => {
  localStorage.setItem(RIDE_DURATION_STORAGE_KEY, '20');
  const useRideDuration = await loadHook();
  const { result } = renderHook(() => useRideDuration());
  expect(result.current[0]).toBe(20);
});

it('stores a new choice and shares it between every place that shows it', async () => {
  const useRideDuration = await loadHook();
  const card = renderHook(() => useRideDuration());
  const other = renderHook(() => useRideDuration());

  act(() => card.result.current[1](30));
  expect(card.result.current[0]).toBe(30);
  expect(other.result.current[0]).toBe(30);
  expect(localStorage.getItem(RIDE_DURATION_STORAGE_KEY)).toBe('30');
});

it('ignores a duration that is not offered', async () => {
  const useRideDuration = await loadHook();
  const { result } = renderHook(() => useRideDuration());
  act(() => result.current[1](20));
  act(() => result.current[1](12));
  expect(result.current[0]).toBe(10);
});
