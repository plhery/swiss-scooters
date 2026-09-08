// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MapBounds, ParkingLocation, ScooterResponse, Vehicle } from '@/lib/types';
import Home from './page';
import { I18nProvider } from '@/lib/i18n';

vi.mock('@/components/MapWrapper', () => ({ default: function MapStub({ onViewportChange, vehicles, parking }: {
  onViewportChange: (bounds: MapBounds, zoom: number) => void; vehicles: Vehicle[]; parking: ParkingLocation[];
}) {
  useEffect(() => onViewportChange({ south: 47.36, west: 8.52, north: 47.39, east: 8.57 }, 16), [onViewportChange]);
  return <><span data-testid="vehicles">{vehicles.length}</span><span data-testid="parking">{parking.length}</span></>;
} }));
vi.mock('@/components/BottomSheet', () => ({ default: ({ enabledProviders, onProviderToggle }: {
  enabledProviders: Set<string>; onProviderToggle: (provider: string) => void;
}) => <button onClick={() => onProviderToggle('lime')}>Providers: {[...enabledProviders].sort().join(',')}</button> }));
vi.mock('@/components/SearchIsland', () => ({ default: () => null }));
vi.mock('@/components/ControlSheet', () => ({ default: () => null }));
vi.mock('@/components/MapCredits', () => ({ default: () => null }));

const response = (): ScooterResponse => ({ vehicles: [{ provider: 'lime', vehicle_id: 'one', lat: 47.377, lng: 8.542,
  battery: 80, range_m: null, distance_m: null, deep_link: null }], clusters: [], providers: { lime: 1 },
  parking: [{ id: 'bay', provider: 'lime', lat: 47.377, lng: 8.542, name: 'Bay', mandatory: true }],
  meta: { generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString(),
    parkingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    mode: 'vehicles', zoom: 16, partial: false, stale: false, failedSources: [], sources: {}, totalVehicles: 1, truncated: false } });
const mount = () => render(<I18nProvider><Home /></I18nProvider>);
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('expires parking and scooters separately even when subsequent refreshes fail', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(response())).mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetcher);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByTestId('vehicles')).toHaveTextContent('1');
  expect(screen.getByTestId('parking')).toHaveTextContent('1');
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(screen.getByTestId('vehicles')).toHaveTextContent('1');
  expect(screen.getByTestId('parking')).toHaveTextContent('0');
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(screen.getByTestId('vehicles')).toHaveTextContent('0');
});

it('times out a stalled request and permits the next automatic refresh', async () => {
  const fetcher = vi.fn().mockImplementationOnce((_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
  })).mockImplementation(async () => Response.json(response()));
  vi.stubGlobal('fetch', fetcher);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(20_180));
  expect(screen.getByRole('button', { name: 'Refresh scooters' })).not.toBeDisabled();
  await act(async () => vi.advanceTimersByTimeAsync(40_000));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('vehicles')).toHaveTextContent('1');
});

it('restores and saves provider preferences without overwriting them during hydration', async () => {
  localStorage.setItem('scooters-providers', JSON.stringify(['lime']));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  const first = mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByRole('button', { name: 'Providers: lime' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Providers: lime' }));
  const saved = localStorage.getItem('scooters-providers');
  expect(JSON.parse(saved!)).toContain('bird');
  first.unmount();
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(localStorage.getItem('scooters-providers')).toBe(saved);
});
