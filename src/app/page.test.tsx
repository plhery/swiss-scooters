// @vitest-environment jsdom
import { useEffect } from 'react';
import { renderToString } from 'react-dom/server';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MapBounds, ParkingLocation, ScooterResponse, Vehicle } from '@/lib/types';
import Home from './page';
import { I18nProvider } from '@/lib/i18n';

const viewport = vi.hoisted(() => ({ bounds: { south: 47.36, west: 8.52, north: 47.39, east: 8.57 } }));
vi.mock('@/components/MapWrapper', () => ({ default: function MapStub({ onViewportChange, onVehicleSelect, vehicles, parking, focusLocation, focusZoom }: {
  onViewportChange: (bounds: MapBounds, zoom: number) => void; onVehicleSelect: (vehicle: Vehicle) => void;
  vehicles: Vehicle[]; parking: ParkingLocation[]; focusLocation: [number, number] | null; focusZoom: number | null;
}) {
  useEffect(() => onViewportChange(viewport.bounds, 16), [onViewportChange]);
  return <><span data-testid="vehicles">{vehicles.length}</span><span data-testid="parking">{parking.length}</span>
    <span data-testid="focus">{focusLocation ? `${focusLocation.join(',')} zoom ${focusZoom}` : 'none'}</span>
    {vehicles.map(vehicle => <button key={vehicle.vehicle_id} onClick={() => onVehicleSelect(vehicle)}>Marker {vehicle.vehicle_id}</button>)}</>;
} }));
vi.mock('@/components/SearchIsland', () => ({ default: ({ onSelect, onClear, placeHasData }: {
  onSelect: (place: object) => void; onClear: () => void; placeHasData: boolean;
}) => <><button onClick={() => onSelect({ lat: 47.3779, lng: 8.5403, display_name: 'Zürich HB, Train', title: 'Zürich HB', subtitle: 'Train', covered: true })}>Search Zürich HB</button>
  <button onClick={() => onSelect({ lat: 46.7741, lng: 8.1558, display_name: 'Lungern, OW', title: 'Lungern', subtitle: 'OW', covered: false })}>Search Lungern</button>
  <button onClick={onClear}>Clear the place</button><span data-testid="place-has-data">{String(placeHasData)}</span></> }));
vi.mock('@/components/ControlSheet', () => ({ default: () => null }));
vi.mock('@/components/MapCredits', () => ({ default: () => null }));

const response = (): ScooterResponse => ({ vehicles: [{ provider: 'lime', vehicle_id: 'one', lat: 47.377, lng: 8.542,
  battery: 80, range_m: null, distance_m: null, deep_link: null }], clusters: [], providers: { lime: 1 },
  parking: [{ id: 'bay', provider: 'lime', lat: 47.377, lng: 8.542, name: 'Bay', mandatory: true }],
  meta: { generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString(),
    parkingExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    mode: 'vehicles', zoom: 16, partial: false, stale: false, failedSources: [], sources: {}, totalVehicles: 1, truncated: false } });
const mount = () => render(<I18nProvider><Home /></I18nProvider>);

const position = { coords: { latitude: 47.3769, longitude: 8.5417, accuracy: 5 }, timestamp: 0 } as GeolocationPosition;
const refused = { code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: '' } as GeolocationPositionError;
function stubNavigator(name: 'geolocation' | 'permissions', value: unknown) {
  Object.defineProperty(navigator, name, { configurable: true, value });
}
/** A browser whose location answers with a fix, or refuses when there is none. */
function stubGeolocation(fix: GeolocationPosition | null) {
  const getCurrentPosition = vi.fn((success: PositionCallback, failure?: PositionErrorCallback | null) => {
    if (fix) success(fix);
    else failure?.(refused);
  });
  stubNavigator('geolocation', { getCurrentPosition, watchPosition: vi.fn(() => 1), clearWatch: vi.fn() });
  return getCurrentPosition;
}

const dockCount = () => document.querySelector('.sheet-count');

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  viewport.bounds = { south: 47.36, west: 8.52, north: 47.39, east: 8.57 };
  window.history.replaceState(null, '', '/');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => {
  // Unmount first: the location watch is stopped through the stub removed below.
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'geolocation');
  Reflect.deleteProperty(navigator, 'permissions');
});

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

it('keeps the scooters and shows no error when a healthy response arrives seconds before its expiry', async () => {
  // The oldest feed in the response is almost five minutes old, so it expires in three seconds.
  const fetcher = vi.fn(async () => {
    const body = response();
    return Response.json({ ...body, meta: { ...body.meta,
      generatedAt: new Date(Date.now() - 297_000).toISOString(), expiresAt: new Date(Date.now() + 3_000).toISOString() } });
  });
  vi.stubGlobal('fetch', fetcher);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByTestId('vehicles')).toHaveTextContent('1');
  for (let second = 0; second < 45; second++) {
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByTestId('vehicles')).toHaveTextContent('1');
    expect(screen.queryByRole('alert')).toBeNull();
  }
  expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(4);
});

it('explains a real load failure under the search bar and clears it when Try again succeeds', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => Response.json(response()));
  vi.stubGlobal('fetch', fetcher);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load scooters.');
  // Nothing has loaded: no count and no chips to filter by.
  expect(dockCount()).toHaveTextContent(/^Waiting for scooter data$/);
  expect(screen.queryByRole('group', { name: 'Filter scooters by provider' })).toBeNull();
  await act(async () => { fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' })); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTestId('vehicles')).toHaveTextContent('1');
  expect(dockCount()).toHaveTextContent(/^1\s*scooter on this map$/);
  expect(screen.getByText('Live')).toBeVisible();
});

it('keeps the scooters and says so in the dock when a refresh fails, then shows the out-of-date card once they expire', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(response())).mockRejectedValue(new Error('down'));
  vi.stubGlobal('fetch', fetcher);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  const shown = new Date().toLocaleTimeString('en-CH', { hour: '2-digit', minute: '2-digit' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Marker one' })); });
  expect(screen.getByRole('heading', { name: 'Lime' })).toBeVisible();

  // The refresh after a minute fails; the data is good for another minute.
  await act(async () => vi.advanceTimersByTimeAsync(61_000));
  expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(screen.getByTestId('vehicles')).toHaveTextContent('1');
  expect(screen.queryByRole('alert')).toBeNull();
  // The card hides the status line, so the failure sits above it with its own way to try again.
  const issue = document.querySelector('.dock-issue') as HTMLElement;
  expect(issue).toHaveTextContent(`Couldn’t refresh · showing ${shown}`);
  expect(within(issue).getByRole('button', { name: 'Try again' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Close scooter details' }));
  expect(dockCount()).toHaveTextContent(/^1\s*scooter on this map$/);
  expect(screen.getByText(`Couldn’t refresh · showing ${shown}`)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Lime, 1. Shown.' })).toBeVisible();

  // Past expiry with the retries still failing: the scooters go, and the dock says why.
  await act(async () => vi.advanceTimersByTimeAsync(70_000));
  expect(screen.getByTestId('vehicles')).toHaveTextContent('0');
  expect(screen.getByRole('heading', { name: 'These positions are out of date' })).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(`Last update ${shown}. Couldn’t load scooters.`);
  expect(dockCount()).toBeNull();
  expect(screen.queryByRole('group', { name: 'Filter scooters by provider' })).toBeNull();

  fetcher.mockImplementation(async () => Response.json(response()));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
  expect(screen.getByTestId('vehicles')).toHaveTextContent('1');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(dockCount()).toHaveTextContent(/^1\s*scooter on this map$/);
  expect(screen.getByText('Live')).toBeVisible();
});

it('measures walking time from a searched place until locating or clearing it', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  stubGeolocation(position);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(dockCount()).toHaveTextContent(/^1\s*scooter on this map$/);
  expect(screen.getByTestId('place-has-data')).toHaveTextContent('true');

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Marker one' })); });
  expect(dockCount()).toBeNull();
  expect(screen.getByRole('button', { name: 'Turn on location to see walking time' })).toBeVisible();

  // The place is the origin: some 160 m from the scooter, and inside the viewport.
  fireEvent.click(screen.getByRole('button', { name: 'Search Zürich HB' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Marker one' })); });
  expect(screen.getByText(/^≈3 min walk from Zürich HB · 16\d m$/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Close scooter details' }));
  expect(dockCount()).toHaveTextContent(/^1\s*scooter nearby$/);

  fireEvent.click(screen.getByRole('button', { name: 'Clear the place' }));
  expect(dockCount()).toHaveTextContent(/^1\s*scooter on this map$/);

  // A place without scooter data: the search bar is told at once, before the map has arrived there.
  fireEvent.click(screen.getByRole('button', { name: 'Search Lungern' }));
  expect(screen.getByTestId('place-has-data')).toHaveTextContent('false');
  fireEvent.click(screen.getByRole('button', { name: 'Clear the place' }));
  expect(screen.getByTestId('place-has-data')).toHaveTextContent('true');

  // Locating from the card: your location replaces the place as the origin.
  fireEvent.click(screen.getByRole('button', { name: 'Search Zürich HB' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Marker one' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Near me' })); });
  expect(screen.getByText(/^≈1 min walk · \d+ m$/)).toBeVisible();
  expect(screen.queryByText(/Zürich HB ·/)).toBeNull();
});

it('locates from the scooter card without moving the map away from the scooter', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  stubGeolocation(position);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Marker one' })); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn on location to see walking time' })); });
  expect(screen.getByText(/^≈1 min walk · \d+ m$/)).toBeVisible();
  expect(screen.getByTestId('focus')).toHaveTextContent('none');
  expect(localStorage.getItem('scooters-located-once')).toBe('1');

  // The locate button still brings the map to you.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Go to my location' })); });
  expect(screen.getByTestId('focus')).toHaveTextContent('47.3769,8.5417 zoom 17');
});

it('explains an area without scooter data and flies to the closest city', async () => {
  // Lungern: no operator serves it.
  viewport.bounds = { south: 46.76, west: 8.13, north: 46.79, east: 8.18 };
  const body = response();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...body, vehicles: [], parking: [], providers: {},
    meta: { ...body.meta, totalVehicles: 0 } })));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByRole('heading', { name: 'No scooter data here yet' })).toBeVisible();
  expect(dockCount()).toBeNull();
  // The search bar must not promise scooters near a place while the dock says this.
  expect(screen.getByTestId('place-has-data')).toHaveTextContent('false');
  const cities = within(screen.getByRole('group', { name: 'Closest cities' })).getAllByRole('button');
  expect(cities.map(city => city.textContent)).toEqual([
    expect.stringMatching(/^Zug · \d+ km$/), expect.stringMatching(/ km$/), expect.stringMatching(/ km$/),
  ]);
  fireEvent.click(cities[0]);
  expect(screen.getByTestId('focus')).toHaveTextContent(/^47\.\d+,8\.\d+ zoom 13$/);
});

it('says how many scooters the filters hide and brings them back', async () => {
  localStorage.setItem('scooters-providers', JSON.stringify(['hopp']));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByTestId('vehicles')).toHaveTextContent('0');
  expect(screen.getByRole('heading', { name: '1 scooter hidden by your filters' })).toBeVisible();
  expect(screen.getByText('Hopp only')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
  expect(screen.getByTestId('vehicles')).toHaveTextContent('1');
  expect(dockCount()).toHaveTextContent(/^1\s*scooter on this map$/);
});

it('times out a stalled request, says so, and recovers with the next automatic refresh', async () => {
  const fetcher = vi.fn().mockImplementationOnce((_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
  })).mockImplementation(async () => Response.json(response()));
  vi.stubGlobal('fetch', fetcher);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(20_180));
  expect(screen.getByRole('alert')).toHaveTextContent('Scooters took too long to respond.');
  await act(async () => vi.advanceTimersByTimeAsync(40_000));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTestId('vehicles')).toHaveTextContent('1');
});

it('has no manual refresh on the map and no first-run card', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.queryByRole('button', { name: /refresh/i })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Find a scooter nearby')).toBeNull();
});

it('labels the locate button until locating has worked once, and remembers only that it did', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  const getCurrentPosition = stubGeolocation(position);
  const first = mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(getCurrentPosition).not.toHaveBeenCalled();
  expect(screen.getByTestId('focus')).toHaveTextContent('none');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Near me' })); });
  expect(getCurrentPosition).toHaveBeenCalledOnce();
  // About 350 m across, as on iOS.
  expect(screen.getByTestId('focus')).toHaveTextContent('47.3769,8.5417 zoom 17');
  expect(screen.queryByRole('button', { name: 'Near me' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Go to my location' })).toBeEnabled();
  expect(localStorage.getItem('scooters-located-once')).toBe('1');
  const stored = Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index)!));
  expect(stored.join(' ')).not.toContain('47.37');
  first.unmount();

  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByRole('button', { name: 'Go to my location' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Near me' })).toBeNull();
});

it('locates by itself when the browser has already granted location, and never otherwise', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  const getCurrentPosition = stubGeolocation(position);
  const query = vi.fn(async () => ({ state: 'prompt' }));
  stubNavigator('permissions', { query });
  const first = mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(query).toHaveBeenCalledWith({ name: 'geolocation' });
  expect(getCurrentPosition).not.toHaveBeenCalled();
  first.unmount();

  query.mockResolvedValue({ state: 'granted' });
  const second = mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(getCurrentPosition).toHaveBeenCalledOnce();
  expect(screen.getByTestId('focus')).toHaveTextContent('47.3769,8.5417 zoom 17');
  second.unmount();

  // A shared link keeps its own place.
  getCurrentPosition.mockClear();
  window.history.replaceState(null, '', '/?origin=45.75,4.85');
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(getCurrentPosition).not.toHaveBeenCalled();
  expect(screen.getByTestId('focus')).toHaveTextContent('45.75,4.85 zoom null');
});

it('says that location is off, and keeps the card dismissed until the next attempt', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  stubGeolocation(null);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.queryByText('Location is off')).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Near me' })); });
  const card = screen.getByText('Location is off').closest('[role="status"]') as HTMLElement;
  expect(card).toHaveTextContent('Turn it on for this site, or search a place instead.');
  // The button keeps its label: locating has not worked yet.
  expect(screen.getByRole('button', { name: 'Near me' })).toBeEnabled();
  expect(localStorage.getItem('scooters-located-once')).toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByText('Location is off')).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Near me' })); });
  expect(screen.getByText('Location is off')).toBeVisible();
});

it('offers another attempt when the browser cannot find the location', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  // jsdom has no geolocation, like a browser that cannot locate at all.
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Near me' })); });
  const card = screen.getByText('Couldn’t find your location.').closest('[role="status"]') as HTMLElement;
  const getCurrentPosition = stubGeolocation(position);
  await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Try again' })); });
  expect(getCurrentPosition).toHaveBeenCalledOnce();
  expect(screen.queryByText('Couldn’t find your location.')).toBeNull();
  expect(screen.queryByText(/Motion access/)).toBeNull();
});

it('renders on the server in the loading state without requesting scooters', () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const html = renderToString(<I18nProvider><Home /></I18nProvider>);
  expect(html).toContain('data-testid="vehicles"');
  expect(html).not.toContain('role="alert"');
  expect(fetcher).not.toHaveBeenCalled();
});

it('carries settings from the old tile parameter over to theme and map', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  window.history.replaceState(null, '', '/?tile=dark&minBattery=45');
  const first = mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(first.container.querySelector('.app-shell')).toHaveAttribute('data-map-theme', 'dark');
  expect(window.location.search).toBe('?minBattery=30&theme=dark');
  first.unmount();

  // A home-screen launch has no URL; the settings come from storage, here in the old format.
  localStorage.setItem('scooters-params', JSON.stringify({ tile: 'osm' }));
  window.history.replaceState(null, '', '/');
  const second = mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(second.container.querySelector('.app-shell')).toHaveAttribute('data-map-theme', 'osm');
  expect(window.location.search).toBe('?map=detailed');
  expect(JSON.parse(localStorage.getItem('scooters-params')!)).toEqual({ map: 'detailed' });
});

it('restores and saves provider preferences without overwriting them during hydration', async () => {
  localStorage.setItem('scooters-providers', JSON.stringify(['lime']));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  const first = mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByRole('button', { name: 'Lime, 1. Shown.' })).toHaveClass('chip-selected');
  expect(screen.getByRole('button', { name: 'Bolt, 0. Hidden.' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lime, 1. Shown.' }));
  const saved = localStorage.getItem('scooters-providers');
  expect(JSON.parse(saved!)).toContain('bird');
  first.unmount();
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(localStorage.getItem('scooters-providers')).toBe(saved);
});
