// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MapControls from '@/components/MapControls';
import { I18nProvider } from '@/lib/i18n';

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem('scooters-locale', 'en');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MapControls', () => {
  it('confirms a successful manual refresh without delaying it', async () => {
    const onRefresh = vi.fn(async () => true);
    render(
      <I18nProvider>
        <MapControls
          loading={false}
          hidden={false}
          onLocateMe={vi.fn()}
          onRefresh={onRefresh}
        />
      </I18nProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh scooters' }));
    });

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Scooters refreshed' })).toBeVisible();

    act(() => vi.advanceTimersByTime(1_200));
    expect(screen.getByRole('button', { name: 'Refresh scooters' })).toBeVisible();
  });
});
