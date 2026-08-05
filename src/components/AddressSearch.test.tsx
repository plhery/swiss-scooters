// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddressSearch from '@/components/AddressSearch';
import { I18nProvider } from '@/lib/i18n';

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem('scooters-locale', 'en');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AddressSearch', () => {
  it('supports keyboard selection from the accessible combobox', async () => {
    const onSelect = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { lat: 47.378, lng: 8.54, display_name: 'Zürich HB, Switzerland' },
    ]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <I18nProvider>
        <AddressSearch onSelect={onSelect} onClear={vi.fn()} />
      </I18nProvider>
    );

    const input = screen.getByRole('combobox', { name: 'Search a Swiss address' });
    fireEvent.change(input, { target: { value: 'Zürich HB' } });
    await act(async () => vi.advanceTimersByTimeAsync(350));

    expect(screen.getByRole('option', { name: 'Zürich HB, Switzerland' })).toBeVisible();
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith({
      lat: 47.378,
      lng: 8.54,
      display_name: 'Zürich HB, Switzerland',
    });
    expect(input).toHaveValue('Zürich HB, Switzerland');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
});
