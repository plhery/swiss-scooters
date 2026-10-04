// @vitest-environment jsdom
import { useEffect } from 'react';
import { renderToString } from 'react-dom/server';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MapBounds, ParkingLocation, ScooterResponse, Vehicle } from '@/lib/types';
import Home from './page';
import { track as sendEvent } from '@/lib/analytics';
import { I18nProvider } from '@/lib/i18n';
import { recentPlaces } from '@/lib/places';

vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
const track = vi.mocked(sendEvent);

const viewport = vi.hoisted(() => ({ bounds: { south: 47.36, west: 8.52, north: 47.39, east: 8.57 } }));
vi.mock('@/components/MapWrapper', () => ({ default: function MapStub({
  onViewportChange, onVehicleSelect, onParkingSelect, selectedParkingId, vehicles, parking, focusLocation, focusZoom, destination,
  hoverTips, popover, zoomStep, selectedVehicleKey, onMapClick, markerLookupRef,
}: {
  markerLookupRef: { current: ((vehicleKey: string | null, parkingId: string | null) => HTMLElement | null) | null };
  hoverTips: boolean; popover: { label: string; content: React.ReactNode } | null; zoomStep: { direction: number; version: number };
  onViewportChange: (bounds: MapBounds, zoom: number) => void; onVehicleSelect: (vehicle: Vehicle) => void;
  onParkingSelect: (location: ParkingLocation) => void; selectedParkingId: string | null;
  selectedVehicleKey: string | null; onMapClick: () => void;
  vehicles: Vehicle[]; parking: ParkingLocation[]; focusLocation: [number, number] | null; focusZoom: number | null;
  destination: { display_name: string } | null;
}) {
  useEffect(() => onViewportChange(viewport.bounds, 16), [onViewportChange]);
  useEffect(() => {
    markerLookupRef.current = (vehicleKey, parkingId) => document.querySelector(`[data-marker="${vehicleKey ?? parkingId}"]`);
  }, [markerLookupRef]);
  return <><span data-testid="vehicles">{vehicles.length}</span><span data-testid="parking">{parking.length}</span>
    <span data-testid="focus">{focusLocation ? `${focusLocation.join(',')} zoom ${focusZoom}` : 'none'}</span>
    <span data-testid="pin">{destination ? destination.display_name : 'none'}</span>
    <span data-testid="tips">{String(hoverTips)}</span><span data-testid="zoom-steps">{zoomStep.version}:{zoomStep.direction}</span>
    <span data-testid="selected">{selectedVehicleKey ?? selectedParkingId ?? 'none'}</span><button onClick={onMapClick}>Tap the map</button>
    {popover && <div role="dialog" aria-label={popover.label}>{popover.content}</div>}
    {vehicles.map(vehicle => <button key={vehicle.vehicle_id} data-marker={`${vehicle.provider}:${vehicle.vehicle_id}`} onClick={() => onVehicleSelect(vehicle)}>Marker {vehicle.vehicle_id}</button>)}
    {parking.map(location => <button key={location.id} data-marker={location.id} aria-pressed={location.id === selectedParkingId} onClick={() => onParkingSelect(location)}>Parking {location.id}</button>)}
    {[15, 16].map(zoom => <button key={zoom} onClick={() => onViewportChange(viewport.bounds, zoom)}>Zoom to {zoom}</button>)}</>;
} }));
vi.mock('@/components/SearchIsland', () => ({ default: ({
  place, placeHasData, hasLocation, locating, recentPlaces, nearbyCities, onExpandedChange, onSelect, onClear,
  expanded, onShowFilters,
}: {
  expanded: boolean; onShowFilters: () => void;
  place: { title: string } | null; placeHasData: boolean; hasLocation: boolean; locating: boolean;
  recentPlaces: { title: string }[]; nearbyCities: { city: string }[];
  onExpandedChange: (expanded: boolean) => void; onSelect: (place: object) => void; onClear: () => void;
}) => <><button onClick={() => onSelect({ lat: 47.3779, lng: 8.5403, display_name: 'Zürich HB, Train', title: 'Zürich HB', subtitle: 'Train', covered: true })}>Search Zürich HB</button>
  <button onClick={() => onSelect({ lat: 46.7741, lng: 8.1558, display_name: 'Lungern, OW', title: 'Lungern', subtitle: 'OW', covered: false })}>Search Lungern</button>
  <button onClick={() => onSelect({ lat: 47.1662, lng: 8.5155, display_name: 'Zug, Switzerland', title: 'Zug', subtitle: 'Switzerland', covered: true, city: true })}>Choose the city of Zug</button>
  <button className="bar-button" onClick={() => onExpandedChange(true)}>Open the search</button><button onClick={() => onExpandedChange(false)}>Close the search</button>
  <button onClick={onClear}>Clear the place</button><span data-testid="place-has-data">{String(placeHasData)}</span>
  <button onClick={onShowFilters}>Open the filters</button><span data-testid="search">{expanded ? 'open' : 'closed'}</span>
  <span data-testid="bar">{place ? place.title : locating ? 'locating' : hasLocation ? 'near you' : 'nothing chosen'}</span>
  <span data-testid="recent">{recentPlaces.map(recent => recent.title).join(', ')}</span>
  <span data-testid="cities">{nearbyCities.map(city => city.city).join(', ')}</span></> }));
vi.mock('@/components/ControlSheet', () => ({ default: ({
  showCount, providerCounts, downProviders, hasActiveFilters, theme, mapStyle,
  onProviderToggle, onMinBatteryChange, onThemeChange, onMapStyleChange, open, onClose,
}: {
  open: boolean; onClose: () => void;
  showCount: number | null; providerCounts: Record<string, number>; downProviders: string[]; hasActiveFilters: boolean;
  theme: string; mapStyle: string;
  onProviderToggle: (provider: string) => void; onMinBatteryChange: (value: number) => void;
  onThemeChange: (theme: string) => void; onMapStyleChange: (style: string) => void;
}) => <><button onClick={() => onProviderToggle('lime')}>Lime in the filters</button>
  <button onClick={() => onMinBatteryChange(60)}>At least 60% in the filters</button>
  <span data-testid="filters">{JSON.stringify({ show: showCount, counts: providerCounts, down: downProviders, active: hasActiveFilters })}</span>
  {['auto', 'light', 'dark'].map(name => <button key={name} onClick={() => onThemeChange(name)}>Appearance {name}</button>)}
  {['calm', 'detailed'].map(name => <button key={name} onClick={() => onMapStyleChange(name)}>Map {name}</button>)}
  <span data-testid="settings">{theme} {mapStyle}</span>
  {open && <button onClick={onClose}>Close the sheet</button>}</> }));
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
/** A browser that takes its time to locate: the fix arrives when the returned function is called. */
function stubSlowGeolocation() {
  let arrive: PositionCallback = () => {};
  const getCurrentPosition = vi.fn((success: PositionCallback) => { arrive = success; });
  stubNavigator('geolocation', { getCurrentPosition, watchPosition: vi.fn(() => 1), clearWatch: vi.fn() });
  return () => arrive(position);
}

const dockCount = () => document.querySelector('.sheet-count');

beforeEach(() => {
  vi.useFakeTimers();
  track.mockClear();
  localStorage.clear();
  recentPlaces.clear();
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

it('tells the search bar what the map is based on: nothing, a location on its way, your location or a place', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  const fixArrives = stubSlowGeolocation();
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  const bar = screen.getByTestId('bar');
  expect(bar).toHaveTextContent('nothing chosen');

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Near me' })); });
  expect(bar).toHaveTextContent('locating');
  await act(async () => fixArrives());
  expect(bar).toHaveTextContent('near you');
  expect(screen.getByTestId('focus')).toHaveTextContent('47.3769,8.5417 zoom 17');

  // A place wins over your location until it is cleared, and has its pin on the map.
  expect(screen.getByTestId('pin')).toHaveTextContent('none');
  fireEvent.click(screen.getByRole('button', { name: 'Search Zürich HB' }));
  expect(bar).toHaveTextContent('Zürich HB');
  expect(screen.getByTestId('pin')).toHaveTextContent(/^Zürich HB, Train$/);
  fireEvent.click(screen.getByRole('button', { name: 'Clear the place' }));
  expect(bar).toHaveTextContent('near you');
  expect(screen.getByTestId('pin')).toHaveTextContent('none');
});

it('clears the place as soon as locating starts, also when the location turns out to be off', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  const fixArrives = stubSlowGeolocation();
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  fireEvent.click(screen.getByRole('button', { name: 'Search Zürich HB' }));
  expect(dockCount()).toHaveTextContent(/^1\s*scooter nearby$/);

  // The bar says that your location is on its way; the place no longer counts.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Near me' })); });
  expect(screen.getByTestId('bar')).toHaveTextContent('locating');
  expect(dockCount()).toHaveTextContent(/^1\s*scooter on this map$/);
  await act(async () => fixArrives());
  expect(screen.getByTestId('bar')).toHaveTextContent('near you');

  stubGeolocation(null);
  fireEvent.click(screen.getByRole('button', { name: 'Search Zürich HB' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Near me' })); });
  expect(screen.getByText('Location is off')).toBeVisible();
  expect(screen.getByTestId('bar')).not.toHaveTextContent('Zürich HB');
  // The place is still one tap away.
  expect(screen.getByTestId('recent')).toHaveTextContent('Zürich HB');
});

it('keeps the map on a place chosen while the location was on its way', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  const fixArrives = stubSlowGeolocation();
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Near me' })); });
  fireEvent.click(screen.getByRole('button', { name: 'Search Zürich HB' }));
  expect(screen.getByTestId('focus')).toHaveTextContent('47.3779,8.5403 zoom null');

  // The place is the later wish: the fix neither moves the map nor replaces the place.
  await act(async () => fixArrives());
  expect(screen.getByTestId('focus')).toHaveTextContent('47.3779,8.5403 zoom null');
  expect(screen.getByTestId('bar')).toHaveTextContent('Zürich HB');
  expect(localStorage.getItem('scooters-located-once')).toBe('1');
  // Your location is known all the same, and takes over once the place is cleared.
  fireEvent.click(screen.getByRole('button', { name: 'Clear the place' }));
  expect(screen.getByTestId('bar')).toHaveTextContent('near you');
});

it('remembers the places chosen during the visit, most recent first, and stores none of them', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  const first = mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByTestId('recent')).toHaveTextContent(/^$/);

  for (const name of ['Search Zürich HB', 'Search Lungern', 'Choose the city of Zug', 'Search Lungern']) {
    fireEvent.click(screen.getByRole('button', { name }));
  }
  expect(screen.getByTestId('recent')).toHaveTextContent(/^Lungern, Zug, Zürich HB$/);
  // Clearing the place does not forget it.
  fireEvent.click(screen.getByRole('button', { name: 'Clear the place' }));
  expect(screen.getByTestId('recent')).toHaveTextContent(/^Lungern, Zug, Zürich HB$/);

  // The privacy notice promises that precise origins are not stored.
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  const kept = [localStorage, sessionStorage].flatMap(storage =>
    Array.from({ length: storage.length }, (_, index) => `${storage.key(index)} ${storage.getItem(storage.key(index)!)}`));
  expect([...kept, window.location.href, document.cookie].join(' ')).not.toMatch(/Lungern|Zug|Zürich|46\.77|47\.16|47\.37/);
  first.unmount();
});

it('shows a chosen city as a whole and any other place at street level', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  fireEvent.click(screen.getByRole('button', { name: 'Choose the city of Zug' }));
  expect(screen.getByTestId('focus')).toHaveTextContent('47.1662,8.5155 zoom 13');
  expect(screen.getByTestId('bar')).toHaveTextContent('Zug');
  fireEvent.click(screen.getByRole('button', { name: 'Search Zürich HB' }));
  expect(screen.getByTestId('focus')).toHaveTextContent('47.3779,8.5403 zoom null');
});

it('offers the six covered cities nearest to the map while the search is open', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByTestId('cities')).toHaveTextContent(/^$/);
  fireEvent.click(screen.getByRole('button', { name: 'Open the search' }));
  // The map is on Zürich.
  const cities = screen.getByTestId('cities').textContent!.split(', ');
  expect(cities).toHaveLength(6);
  expect(cities[0]).toBe('Zürich');
  expect(cities).toContain('Uster');
  fireEvent.click(screen.getByRole('button', { name: 'Close the search' }));
  expect(screen.getByTestId('cities')).toHaveTextContent(/^$/);
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
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Near me' })); });
  expect(screen.getByTestId('focus')).toHaveTextContent('47.3769,8.5417 zoom 17');
});

it('opens a parking bay in the dock, and only one of a bay and a scooter at a time', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  const parking = () => screen.getByRole('button', { name: 'Parking bay' });
  expect(parking()).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(parking());
  expect(screen.getByRole('heading', { name: 'Lime parking bay' })).toBeVisible();
  // No origin: the name of the bay alone.
  expect(document.querySelector('.card-title p')).toHaveTextContent(/^Bay$/);
  expect(screen.getByText('You must park in a bay in this zone.')).toBeVisible();
  expect(screen.getByText('Check the Lime app before you end your ride.')).toBeVisible();
  expect(dockCount()).toBeNull();
  expect(parking()).toHaveAttribute('aria-pressed', 'true');

  // A scooter takes the bay's place...
  fireEvent.click(screen.getByRole('button', { name: 'Marker one' }));
  expect(screen.getByRole('button', { name: 'Close scooter details' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Lime parking bay' })).toBeNull();
  expect(parking()).toHaveAttribute('aria-pressed', 'false');

  // ...and a bay the scooter's.
  fireEvent.click(parking());
  expect(screen.getByRole('heading', { name: 'Lime parking bay' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Close scooter details' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Close parking details' }));
  expect(parking()).toHaveAttribute('aria-pressed', 'false');
  expect(dockCount()).toHaveTextContent(/^1\s*scooter on this map$/);
  // Closing the bay does not bring the scooter's card back.
  expect(screen.queryByRole('button', { name: 'Close scooter details' })).toBeNull();
});

it('measures the walk to a parking bay from your location or from the searched place', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  stubGeolocation(position);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Near me' })); });
  fireEvent.click(screen.getByRole('button', { name: 'Parking bay' }));
  expect(document.querySelector('.card-title p')).toHaveTextContent(/^Bay · ≈1 min walk$/);

  // Some 160 m from the place, and the place wins over your location.
  fireEvent.click(screen.getByRole('button', { name: 'Search Zürich HB' }));
  fireEvent.click(screen.getByRole('button', { name: 'Parking bay' }));
  expect(document.querySelector('.card-title p')).toHaveTextContent(/^Bay · ≈3 min walk from Zürich HB$/);
});

it('shows parking bays from street level, and closes the card of a bay that leaves the map', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  fireEvent.click(screen.getByRole('button', { name: 'Parking bay' }));
  expect(screen.getByRole('heading', { name: 'Lime parking bay' })).toBeVisible();

  // Further out there are no bays on the map, so there is none to describe.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Zoom to 15' })); });
  expect(screen.getByTestId('parking')).toHaveTextContent('0');
  expect(screen.queryByRole('heading', { name: 'Lime parking bay' })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Zoom to 16' })); });
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByTestId('parking')).toHaveTextContent('1');
  // The bay is back on the map; its card is not, until it is chosen again.
  expect(screen.queryByRole('heading', { name: 'Lime parking bay' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Parking bay' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByTestId('selected')).toHaveTextContent('none');

  // Switching its provider off in the filters removes the bay, and its card with it.
  fireEvent.click(screen.getByRole('button', { name: 'Parking bay' }));
  expect(screen.getByRole('heading', { name: 'Lime parking bay' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Lime in the filters' }));
  expect(screen.getByTestId('parking')).toHaveTextContent('0');
  expect(screen.queryByRole('heading', { name: 'Lime parking bay' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Lime in the filters' }));
  expect(screen.getByTestId('parking')).toHaveTextContent('1');
  expect(screen.queryByRole('heading', { name: 'Lime parking bay' })).toBeNull();
  expect(screen.getByTestId('selected')).toHaveTextContent('none');
});

it('keeps the card of a scooter closed once the scooter has left the map, also when it is back', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  const moveTo = async (bounds: MapBounds) => {
    viewport.bounds = bounds;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Zoom to 16' })); });
    await act(async () => vi.advanceTimersByTimeAsync(180));
  };
  const zurich = viewport.bounds;
  fireEvent.click(screen.getByRole('button', { name: 'Marker one' }));
  expect(screen.getByRole('heading', { name: 'Lime' })).toBeVisible();
  expect(screen.getByTestId('selected')).toHaveTextContent('lime:one');

  // A refresh that still holds the scooter leaves its card open.
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(screen.getByRole('heading', { name: 'Lime' })).toBeVisible();

  // Dragged out of view: the card closes, and nothing is selected any more.
  await moveTo({ south: 47.40, west: 8.52, north: 47.43, east: 8.57 });
  expect(screen.getByTestId('vehicles')).toHaveTextContent('0');
  expect(screen.queryByRole('heading', { name: 'Lime' })).toBeNull();
  expect(screen.getByTestId('selected')).toHaveTextContent('none');

  // Back in view, the scooter is there and its card stays closed.
  await moveTo(zurich);
  expect(screen.getByTestId('vehicles')).toHaveTextContent('1');
  expect(screen.queryByRole('heading', { name: 'Lime' })).toBeNull();
  expect(screen.getByTestId('selected')).toHaveTextContent('none');
  expect(dockCount()).toHaveTextContent(/^1\s*scooter on this map$/);

  // The same when its provider is switched off and on again.
  fireEvent.click(screen.getByRole('button', { name: 'Marker one' }));
  expect(screen.getByRole('heading', { name: 'Lime' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Lime in the filters' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lime in the filters' }));
  expect(screen.getByTestId('vehicles')).toHaveTextContent('1');
  expect(screen.queryByRole('heading', { name: 'Lime' })).toBeNull();
  expect(screen.getByTestId('selected')).toHaveTextContent('none');
});

it('closes the card of a scooter or a bay with a tap on the map', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  track.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Marker one' }));
  expect(screen.getByRole('heading', { name: 'Lime' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Tap the map' }));
  expect(screen.queryByRole('heading', { name: 'Lime' })).toBeNull();
  expect(screen.getByTestId('selected')).toHaveTextContent('none');
  expect(track).toHaveBeenCalledWith('vehicle_dismiss');

  fireEvent.click(screen.getByRole('button', { name: 'Parking bay' }));
  expect(screen.getByRole('heading', { name: 'Lime parking bay' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Tap the map' }));
  expect(screen.queryByRole('heading', { name: 'Lime parking bay' })).toBeNull();
  expect(dockCount()).toHaveTextContent(/^1\s*scooter on this map$/);

  // With nothing open a tap does nothing.
  track.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Tap the map' }));
  expect(track).not.toHaveBeenCalled();
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
  cities[0].focus();
  fireEvent.click(cities[0]);
  expect(screen.getByTestId('focus')).toHaveTextContent(/^47\.\d+,8\.\d+ zoom 13$/);
  // The chip leaves with its card once the map has arrived: the focus is handed on before it does.
  expect(screen.getByRole('button', { name: 'Open the search' })).toHaveFocus();
});

it('says how many scooters the filters hide and brings them back', async () => {
  localStorage.setItem('scooters-providers', JSON.stringify(['hopp']));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByTestId('vehicles')).toHaveTextContent('0');
  expect(screen.getByRole('heading', { name: '1 scooter hidden by your filters' })).toBeVisible();
  expect(screen.getByText('Hopp only')).toBeVisible();
  screen.getByRole('button', { name: 'Show all' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
  expect(screen.getByTestId('vehicles')).toHaveTextContent('1');
  expect(dockCount()).toHaveTextContent(/^1\s*scooter on this map$/);
  // The button went with its card; the focus is not left on nothing.
  expect(screen.getByRole('button', { name: 'Open the search' })).toHaveFocus();
});

it('tells the filters what the map will show, what each provider has in view and who is not sharing data', async () => {
  const body = response();
  body.vehicles.push({ ...body.vehicles[0], provider: 'voi', vehicle_id: 'two', battery: 40 });
  // Bird shows nothing here. A feed of Voi failed too, but another one has a scooter on screen.
  body.meta.failedSources = ['national:bird_zurich', 'national:voi_winterthur'];
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)));
  mount();
  const filters = () => JSON.parse(screen.getByTestId('filters').textContent!);
  // Nothing has answered yet: there is no count to promise.
  expect(filters()).toEqual({ show: null, counts: {}, down: [], active: false });
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(filters()).toEqual({ show: 2, counts: { lime: 1, voi: 1 }, down: ['bird'], active: false });
  expect(screen.getByText('Bird isn’t sharing data right now.')).toBeVisible();

  // Counts follow the battery choice and ignore the provider choice, so each row says what it would add.
  // Voi's only scooter is now hidden by the rider's own choice: that does not make Voi down.
  fireEvent.click(screen.getByRole('button', { name: 'At least 60% in the filters' }));
  expect(filters()).toEqual({ show: 1, counts: { lime: 1 }, down: ['bird'], active: true });
  fireEvent.click(screen.getByRole('button', { name: 'Lime in the filters' }));
  expect(filters()).toEqual({ show: 0, counts: { lime: 1 }, down: ['bird'], active: true });
  expect(screen.queryByRole('button', { name: 'Voi: not sharing data right now' })).not.toBeInTheDocument();
});

it('names no provider as not sharing data while city totals are shown', async () => {
  const body = response();
  body.vehicles = [];
  body.clusters = [{ id: 'city:ch:zurich', lat: 47.377, lng: 8.542, count: 100, providers: { lime: 100 }, city: 'Zürich' }];
  body.meta = { ...body.meta, mode: 'clusters', zoom: 8, overview: true, refreshAfterSeconds: 3600, partial: true,
    failedSources: ['national:bird_zurich', 'france:dott_fr_lyon', 'city-overview'] };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByText('City totals · refreshed hourly')).toBeVisible();
  expect(JSON.parse(screen.getByTestId('filters').textContent!)).toMatchObject({ counts: { lime: 100 }, down: [] });
  expect(screen.queryByText(/sharing data right now/)).not.toBeInTheDocument();
  expect(document.querySelector('.chip-down')).toBeNull();
});

it('names no provider as not sharing data from what was loaded for another view', async () => {
  const body = response();
  body.meta.failedSources = ['national:bird_zurich'];
  const fetcher = vi.fn<() => Promise<Response>>(async () => Response.json(body));
  vi.stubGlobal('fetch', fetcher);
  mount();
  const down = () => JSON.parse(screen.getByTestId('filters').textContent!).down;
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(down()).toEqual(['bird']);
  // A refresh of the same view that fails leaves what is on screen as it was.
  fetcher.mockRejectedValue(new Error('offline'));
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(document.querySelector('.dock-retry, .sheet')).toHaveTextContent('Try again');
  expect(down()).toEqual(['bird']);

  // Another view is asked for and its answer does not come: nothing on screen speaks for it.
  fireEvent.click(screen.getByRole('button', { name: 'Zoom to 15' }));
  expect(down()).toEqual([]);
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(down()).toEqual([]);
  expect(screen.queryByText('Bird isn’t sharing data right now.')).not.toBeInTheDocument();
  expect(document.querySelector('.chip-down')).toBeNull();
});

it('promises no count in the filters while the answer for a new minimum is on its way', async () => {
  const fetcher = vi.fn<(input: string) => Promise<Response>>(async () => Response.json(response()));
  vi.stubGlobal('fetch', fetcher);
  mount();
  const show = () => JSON.parse(screen.getByTestId('filters').textContent!).show;
  await act(async () => vi.advanceTimersByTimeAsync(180));
  // Zoomed out, the server applies the minimum.
  fireEvent.click(screen.getByRole('button', { name: 'Zoom to 15' }));
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(show()).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'At least 60% in the filters' }));
  expect(show()).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(fetcher.mock.calls.at(-1)![0]).toContain('minBattery=60');
  expect(show()).toBe(1);
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
  // The icon alone from now on, under the same name.
  expect(document.querySelector('.near-me')).toBeNull();
  expect(screen.getByRole('button', { name: 'Near me' })).toHaveClass('fab');
  expect(screen.getByRole('button', { name: 'Near me' })).toBeEnabled();
  expect(localStorage.getItem('scooters-located-once')).toBe('1');
  const stored = Array.from({ length: localStorage.length }, (_, index) => localStorage.getItem(localStorage.key(index)!));
  expect(stored.join(' ')).not.toContain('47.37');
  first.unmount();

  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByRole('button', { name: 'Near me' })).toHaveClass('fab');
  expect(document.querySelector('.near-me')).toBeNull();
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
  within(card).getByRole('button', { name: 'Dismiss' }).focus();
  fireEvent.click(within(card).getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByText('Location is off')).toBeNull();
  // The button went with the card; the focus moves to the search bar, which the card pointed to.
  expect(screen.getByRole('button', { name: 'Open the search' })).toHaveFocus();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Near me' })); });
  expect(screen.getByText('Location is off')).toBeVisible();
});

it('shows how to turn location back on from the card, and keeps the card for when you come back', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  // jsdom has neither modal dialogs nor animations.
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion') }));
  stubGeolocation(null);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  // The only sheet that is not replaced by a stand-in in this file.
  const help = () => document.querySelector('dialog')!;
  expect(help()).not.toHaveAttribute('open');
  expect(help().querySelectorAll('li')).toHaveLength(0);

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Near me' })); });
  fireEvent.click(screen.getByRole('button', { name: 'See how' }));
  expect(screen.getByRole('dialog', { name: 'Turn location back on' })).toBe(help());
  expect(help()).toHaveAttribute('open');
  // One step for the browser, and one for the device where it is known.
  expect(within(help()).getAllByRole('listitem').length).toBeGreaterThanOrEqual(1);
  expect(help()).toHaveTextContent('Then come back and tap Near me.');

  fireEvent.click(within(help()).getByRole('button', { name: 'Done' }));
  expect(help()).not.toHaveAttribute('open');
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
  // Before any script runs the appearance is the system's.
  expect(html).toContain('data-theme="auto"');
  expect(html).toContain('<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1c1c1e"/>');
  expect(html).toContain('<meta name="theme-color" media="(prefers-color-scheme: light)" content="#e0ddd8"/>');
});

const shell = () => document.querySelector('.app-shell')!;
/** The colour the browser gives its bars while the system is light or dark. */
const themeColors = () => ['light', 'dark'].map(scheme => document.head
  .querySelector(`meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`)?.getAttribute('content'));

it('carries settings from the old tile parameter over to theme and map', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  window.history.replaceState(null, '', '/?tile=dark&minBattery=45');
  const first = mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(shell()).toHaveAttribute('data-theme', 'dark');
  expect(shell()).toHaveAttribute('data-map', 'calm');
  expect(screen.getByTestId('settings')).toHaveTextContent('dark calm');
  expect(window.location.search).toBe('?minBattery=30&theme=dark');
  first.unmount();

  // A home-screen launch has no URL; the settings come from storage, here in the old format.
  localStorage.setItem('scooters-params', JSON.stringify({ tile: 'osm' }));
  window.history.replaceState(null, '', '/');
  const second = mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  // "OSM" was a map style of the light appearance; the appearance is now the system's.
  expect(shell()).toHaveAttribute('data-theme', 'auto');
  expect(shell()).toHaveAttribute('data-map', 'detailed');
  expect(window.location.search).toBe('?map=detailed');
  expect(JSON.parse(localStorage.getItem('scooters-params')!)).toEqual({ map: 'detailed' });
  second.unmount();

  // The old light style is what nothing chosen means today.
  window.history.replaceState(null, '', '/?tile=light');
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByTestId('settings')).toHaveTextContent('auto calm');
  expect(window.location.search).toBe('');
});

it('leaves Automatic to the system, and keeps a chosen appearance and map style in the link and on the device', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  const view = mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  // Automatic and calm are what nothing chosen means: the stylesheet follows the system.
  expect(shell()).toHaveAttribute('data-theme', 'auto');
  expect(shell()).toHaveAttribute('data-map', 'calm');
  expect(themeColors()).toEqual(['#e0ddd8', '#1c1c1e']);
  expect(window.location.search).toBe('');

  fireEvent.click(screen.getByRole('button', { name: 'Appearance dark' }));
  expect(shell()).toHaveAttribute('data-theme', 'dark');
  // A chosen appearance holds whatever the system says.
  expect(themeColors()).toEqual(['#1c1c1e', '#1c1c1e']);
  expect(window.location.search).toBe('?theme=dark');
  expect(JSON.parse(localStorage.getItem('scooters-params')!)).toEqual({ theme: 'dark' });

  fireEvent.click(screen.getByRole('button', { name: 'Map detailed' }));
  expect(shell()).toHaveAttribute('data-theme', 'dark');
  expect(shell()).toHaveAttribute('data-map', 'detailed');
  expect(window.location.search).toBe('?theme=dark&map=detailed');

  fireEvent.click(screen.getByRole('button', { name: 'Appearance light' }));
  expect(shell()).toHaveAttribute('data-theme', 'light');
  expect(themeColors()).toEqual(['#e0ddd8', '#e0ddd8']);
  expect(window.location.search).toBe('?theme=light&map=detailed');
  expect(JSON.parse(localStorage.getItem('scooters-params')!)).toEqual({ theme: 'light', map: 'detailed' });

  fireEvent.click(screen.getByRole('button', { name: 'Appearance auto' }));
  fireEvent.click(screen.getByRole('button', { name: 'Map calm' }));
  expect(themeColors()).toEqual(['#e0ddd8', '#1c1c1e']);
  expect(window.location.search).toBe('');
  expect(JSON.parse(localStorage.getItem('scooters-params')!)).toEqual({});
  // Nothing is forced on the page from a script, and nothing is left behind.
  expect(document.documentElement.style.colorScheme).toBe('');
  expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(2);
  view.unmount();
  expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(0);
});

it('restores a chosen appearance and map style from the link', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  window.history.replaceState(null, '', '/?theme=light&map=detailed');
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(shell()).toHaveAttribute('data-theme', 'light');
  expect(shell()).toHaveAttribute('data-map', 'detailed');
  expect(themeColors()).toEqual(['#e0ddd8', '#e0ddd8']);
  expect(window.location.search).toBe('?theme=light&map=detailed');
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

/** A wide window with a mouse: the layout of src/lib/useDesktopLayout.ts. */
function stubDesktop() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 900px) and (pointer: fine)' }));
}
const press = (key: string, init: KeyboardEventInit = {}) =>
  act(async () => { fireEvent.keyDown(document.body, { key, ...init }); });

it('on a desktop opens the card beside the marker, keeps the count and the providers, and closes it with Escape', async () => {
  stubDesktop();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByTestId('tips')).toHaveTextContent('true');
  // The providers are a legend: one row each, and no "All".
  const legend = screen.getByRole('group', { name: 'Filter scooters by provider' });
  expect(legend).toHaveClass('legend');
  expect(within(legend).getByRole('button', { name: 'Lime, 1. Shown.' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(legend).queryByRole('button', { name: /^All providers/ })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Marker one' }));
  const card = screen.getByRole('dialog', { name: 'Lime scooter' });
  expect(within(card).getByRole('heading', { name: 'Lime' })).toBeVisible();
  expect(within(card).getByRole('link', { name: 'Directions' })).toBeVisible();
  // The dock keeps what it showed.
  expect(dockCount()).toHaveTextContent(/^1\s*scooter on this map$/);
  expect(screen.getByRole('group', { name: 'Filter scooters by provider' })).toBe(legend);
  expect(document.querySelector('.sheet .dock-card')).toBeNull();

  // A bay takes the scooter's place, one card at a time.
  fireEvent.click(screen.getByRole('button', { name: 'Parking bay' }));
  expect(screen.queryByRole('dialog', { name: 'Lime scooter' })).toBeNull();
  expect(within(screen.getByRole('dialog', { name: 'Lime parking bay' })).getByText('You must park in a bay in this zone.')).toBeVisible();

  await press('Escape');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Parking bay' })).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(screen.getByRole('button', { name: 'Marker one' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Lime scooter' })).getByRole('button', { name: 'Close scooter details' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('on a desktop a legend row behaves like its chip: alone on the first click, everything again on the second', async () => {
  stubDesktop();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  const row = (name: RegExp) => screen.getByRole('button', { name });

  fireEvent.click(row(/^Lime, 1\./));
  expect(row(/^Lime, 1\./)).toHaveAttribute('aria-pressed', 'true');
  expect(row(/^Bolt, 0\./)).toHaveAttribute('aria-pressed', 'false');
  expect(row(/^Bolt, 0\./)).toHaveAccessibleName('Bolt, 0. Hidden.');
  expect(JSON.parse(localStorage.getItem('scooters-providers')!)).toEqual(['lime']);

  fireEvent.click(row(/^Lime, 1\./));
  expect(row(/^Bolt, 0\./)).toHaveAttribute('aria-pressed', 'true');
});

it('on a desktop lists the keys in the corner and follows them', async () => {
  stubDesktop();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  const getCurrentPosition = stubGeolocation(position);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  const hints = [...document.querySelectorAll('.key-hints li')].map(hint => hint.textContent);
  expect(hints).toEqual(['/Search', 'LNear me', '+ −Zoom', 'EscClose']);

  // "+" and "-" zoom one step each.
  await press('+');
  expect(screen.getByTestId('zoom-steps')).toHaveTextContent('1:1');
  await press('-');
  expect(screen.getByTestId('zoom-steps')).toHaveTextContent('2:-1');
  // The browser's own zoom is left alone.
  await press('+', { metaKey: true });
  await press('-', { ctrlKey: true });
  expect(screen.getByTestId('zoom-steps')).toHaveTextContent('2:-1');

  await press('l');
  expect(getCurrentPosition).toHaveBeenCalledOnce();
  expect(screen.getByTestId('focus')).toHaveTextContent('47.3769,8.5417 zoom 17');

  // "/" opens the search, and the character does not reach its field.
  const slash = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
  await act(async () => { document.body.dispatchEvent(slash); });
  expect(slash.defaultPrevented).toBe(true);
  expect(screen.getByTestId('search')).toHaveTextContent('open');
  // While the search is open the letters belong to it, and Escape closes it first.
  fireEvent.click(screen.getByRole('button', { name: 'Marker one' }));
  await press('l');
  expect(getCurrentPosition).toHaveBeenCalledOnce();
  await press('Escape');
  expect(screen.getByTestId('search')).toHaveTextContent('closed');
  expect(screen.getByRole('dialog', { name: 'Lime scooter' })).toBeVisible();
  await press('Escape');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('on a desktop leaves the keys alone while typing and while a sheet is open', async () => {
  stubDesktop();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  const getCurrentPosition = stubGeolocation(position);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  fireEvent.click(screen.getByRole('button', { name: 'Marker one' }));

  const field = document.body.appendChild(document.createElement('input'));
  await act(async () => { fireEvent.keyDown(field, { key: 'l' }); });
  await act(async () => { fireEvent.keyDown(field, { key: '+' }); });
  await act(async () => { fireEvent.keyDown(field, { key: 'Escape' }); });
  field.remove();
  expect(getCurrentPosition).not.toHaveBeenCalled();
  expect(screen.getByTestId('zoom-steps')).toHaveTextContent('0:1');
  expect(screen.getByRole('dialog', { name: 'Lime scooter' })).toBeVisible();

  // A sheet closes itself with Escape; the card under it stays.
  fireEvent.click(screen.getByRole('button', { name: 'Open the filters' }));
  await press('Escape');
  await press('l');
  await press('/');
  expect(screen.getByRole('dialog', { name: 'Lime scooter' })).toBeVisible();
  expect(getCurrentPosition).not.toHaveBeenCalled();
  expect(screen.getByTestId('search')).toHaveTextContent('closed');
  fireEvent.click(screen.getByRole('button', { name: 'Close the sheet' }));
  await press('Escape');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('on a phone moves the focus into the card that opens in the dock, and back to its marker when it closes', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  const marker = screen.getByRole('button', { name: 'Marker one' });
  marker.focus();
  fireEvent.click(marker);
  // Named, so that a screen reader says what opened at the far end of the page.
  const card = screen.getByRole('group', { name: 'Lime scooter' });
  expect(card).toHaveFocus();
  expect(within(card).getByRole('heading', { name: 'Lime' })).toBeVisible();
  const close = within(card).getByRole('button', { name: 'Close scooter details' });
  close.focus();
  fireEvent.click(close);
  expect(screen.queryByRole('group', { name: 'Lime scooter' })).toBeNull();
  expect(marker).toHaveFocus();

  const bay = screen.getByRole('button', { name: 'Parking bay' });
  bay.focus();
  fireEvent.click(bay);
  expect(screen.getByRole('group', { name: 'Lime parking bay' })).toHaveFocus();
  screen.getByRole('button', { name: 'Close parking details' }).focus();
  fireEvent.click(screen.getByRole('button', { name: 'Close parking details' }));
  expect(bay).toHaveFocus();
});

it('on a phone keeps the card in the dock, the chips, and no keys', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(response())));
  const getCurrentPosition = stubGeolocation(position);
  mount();
  await act(async () => vi.advanceTimersByTimeAsync(180));
  expect(screen.getByTestId('tips')).toHaveTextContent('false');
  expect(document.querySelector('.key-hints')).toBeNull();
  expect(screen.getByRole('group', { name: 'Filter scooters by provider' })).toHaveClass('chips');
  expect(screen.getByRole('button', { name: 'All providers, 1. Show all.' })).toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Marker one' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.querySelector('.sheet .dock-card')).not.toBeNull();
  expect(dockCount()).toBeNull();

  await press('Escape');
  await press('l');
  await press('+');
  await press('/');
  expect(document.querySelector('.sheet .dock-card')).not.toBeNull();
  expect(getCurrentPosition).not.toHaveBeenCalled();
  expect(screen.getByTestId('zoom-steps')).toHaveTextContent('0:1');
  expect(screen.getByTestId('search')).toHaveTextContent('closed');
});
