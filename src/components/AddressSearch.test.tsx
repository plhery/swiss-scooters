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

    const input = screen.getByRole('combobox', { name: 'City or address' });
    fireEvent.change(input, { target: { value: 'Zürich HB' } });
    await act(async () => vi.advanceTimersByTimeAsync(350));

    expect(fetchMock).toHaveBeenCalledWith('/api/geocode', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ q: 'Zürich HB', lang: 'en' }),
      cache: 'no-store',
    }));

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

it('shows an error after a search stalls and can search again', async () => {
  const fetcher = vi.fn().mockImplementationOnce((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
  })).mockImplementation(async () => Response.json([{ lat: 47.378, lng: 8.54, display_name: 'Zurich' }]));
  vi.stubGlobal('fetch', fetcher);
  render(<I18nProvider><AddressSearch onSelect={vi.fn()} onClear={vi.fn()} /></I18nProvider>);
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: 'Zur' } });
  await act(async () => vi.advanceTimersByTimeAsync(12_350));
  expect(screen.getByRole('status')).toHaveClass('search-status-error');
  fireEvent.change(input, { target: { value: 'Zurich' } });
  await act(async () => vi.advanceTimersByTimeAsync(350));
  expect(screen.getByRole('option', { name: 'Zurich' })).toBeVisible();
});
