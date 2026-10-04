// @vitest-environment jsdom

import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchIsland from '@/components/SearchIsland';
import { I18nProvider } from '@/lib/i18n';
import type { Place } from '@/lib/places';

const zurich: Place = { lat: 47.3779, lng: 8.5403, display_name: 'Zürich HB, Train', title: 'Zürich HB', subtitle: 'Train', covered: true };
const lungern: Place = { lat: 46.7741, lng: 8.1558, display_name: 'Lungern, OW', title: 'Lungern', subtitle: 'OW', covered: false };

type Props = React.ComponentProps<typeof SearchIsland>;

function island(overrides: Partial<Props> = {}) {
  return (
    <I18nProvider>
      <SearchIsland
        place={null}
        placeHasData
        hasLocation={false}
        locating={false}
        expanded={false}
        hasActiveFilters={false}
        recentPlaces={[]}
        nearbyCities={[]}
        onExpandedChange={vi.fn()}
        onSelect={vi.fn()}
        onClear={vi.fn()}
        onLocate={vi.fn()}
        onShowFilters={vi.fn()}
        onShowSettings={vi.fn()}
        {...overrides}
      />
    </I18nProvider>
  );
}

/** The island as the page holds it: it opens, closes and keeps the chosen place. */
function Harness(overrides: Partial<Props>) {
  const [expanded, setExpanded] = useState(false);
  const [place, setPlace] = useState<Place | null>(overrides.place ?? null);
  return island({
    ...overrides,
    place,
    expanded,
    onExpandedChange: (next) => { overrides.onExpandedChange?.(next); setExpanded(next); },
    onSelect: (chosen) => { overrides.onSelect?.(chosen); setPlace(chosen); },
    onClear: () => { overrides.onClear?.(); setPlace(null); },
  });
}

const bar = () => document.querySelector<HTMLButtonElement>('.bar-button')!;
const buttonNames = () => screen.getAllByRole('button').map(button => button.getAttribute('aria-label') ?? button.textContent);

beforeEach(() => {
  localStorage.setItem('scooters-locale', 'en');
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the collapsed bar', () => {
  it('reads like an empty search field while nothing is chosen', () => {
    render(island());

    expect(bar()).toHaveAccessibleName('Search city or address');
    expect(bar().querySelector('.bar-placeholder')).toHaveTextContent('Search city or address');
    expect(buttonNames()).toEqual(['Search city or address', 'Filters', 'Settings']);
  });

  it('says that the scooters are near you once you are located', () => {
    render(island({ hasLocation: true }));

    expect(screen.getByText('Near you')).toBeVisible();
    expect(screen.getByText('Tap to search a city or address')).toBeVisible();
    expect(bar()).toHaveAccessibleName('Showing scooters near you. Search a city or address.');
    expect(buttonNames()).toEqual([bar().getAttribute('aria-label'), 'Filters', 'Settings']);
  });

  it('names the searched place and offers to clear it', () => {
    const onClear = vi.fn();
    render(island({ place: zurich, onClear }));

    expect(screen.getByText('Zürich HB')).toBeVisible();
    expect(screen.getByText('Scooters near this place')).toBeVisible();
    expect(bar()).toHaveAccessibleName('Showing scooters near Zürich HB. Search another place.');
    expect(buttonNames()).toEqual([bar().getAttribute('aria-label'), 'Clear place', 'Filters', 'Settings']);

    fireEvent.click(screen.getByRole('button', { name: 'Clear place' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('does not promise scooters near a place that has no scooter data', () => {
    render(island({ place: lungern, placeHasData: false }));

    expect(screen.getByText('Lungern')).toBeVisible();
    expect(screen.queryByText('Scooters near this place')).toBeNull();
    expect(screen.getByText('Tap to search a city or address')).toBeVisible();
    expect(bar()).toHaveAccessibleName('Lungern. Tap to search a city or address');
    expect(screen.getByRole('button', { name: 'Clear place' })).toBeVisible();
  });

  it('shows a location on its way in the bar itself', () => {
    render(island({ locating: true, hasLocation: true }));

    expect(bar()).toHaveAccessibleName('Finding your location…');
    expect(bar().querySelector('.mini-spinner')).not.toBeNull();
    expect(screen.queryByText('Near you')).toBeNull();
    expect(buttonNames()).toEqual(['Finding your location…', 'Filters', 'Settings']);
  });

  it('lets a searched place win over your location, found or on its way', () => {
    render(island({ place: zurich, hasLocation: true, locating: true }));

    expect(screen.getByText('Zürich HB')).toBeVisible();
    expect(screen.queryByText('Near you')).toBeNull();
    expect(screen.queryByText('Finding your location…')).toBeNull();
  });

  it('keeps its usual lines while no place is chosen, whatever the dock shows', () => {
    render(island({ placeHasData: false, hasLocation: true }));

    expect(screen.getByText('Near you')).toBeVisible();
    expect(screen.getByText('Tap to search a city or address')).toBeVisible();
  });

  it.each([
    ['nothing chosen', {}],
    ['your location', { hasLocation: true }],
    ['a place', { place: zurich }],
    ['a place without data', { place: lungern, placeHasData: false }],
    ['locating', { locating: true }],
  ])('never speaks of an origin: %s', (_state, props: Partial<Props>) => {
    const { container } = render(island(props));

    expect(container.textContent).not.toMatch(/origin/i);
    expect(buttonNames().join(' ')).not.toMatch(/origin/i);
  });

  it('marks the Filters button while filters are active and opens both sheets', () => {
    const onShowFilters = vi.fn();
    const onShowSettings = vi.fn();
    render(island({ hasActiveFilters: true, onShowFilters, onShowSettings }));

    fireEvent.click(screen.getByRole('button', { name: 'Filters active' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onShowFilters).toHaveBeenCalledOnce();
    expect(onShowSettings).toHaveBeenCalledOnce();
  });

  it('keeps the keyboard focus in the bar when the place is cleared', () => {
    render(<Harness place={zurich} />);

    const clear = screen.getByRole('button', { name: 'Clear place' });
    clear.focus();
    fireEvent.click(clear);
    expect(screen.queryByRole('button', { name: 'Clear place' })).toBeNull();
    expect(bar()).toHaveAccessibleName('Search city or address');
    expect(bar()).toHaveFocus();
  });
});

describe('the open search', () => {
  it('opens on the field with Cancel, without a title or a shortcut to the filters', () => {
    const onExpandedChange = vi.fn();
    render(<Harness onExpandedChange={onExpandedChange} />);

    fireEvent.click(bar());
    expect(onExpandedChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('combobox', { name: 'City or address' })).toHaveFocus();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(buttonNames()).toEqual(['Cancel', 'Use my location']);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onExpandedChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(bar()).toHaveFocus();
  });

  it('closes with Escape, leaves the chosen place alone and returns to the bar', () => {
    const onClear = vi.fn();
    render(<Harness place={zurich} onClear={onClear} />);

    fireEvent.click(bar());
    const input = screen.getByRole('combobox');
    // The field starts empty: the place is changed by choosing another one.
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'Be' } });
    const escape = fireEvent.keyDown(input, { key: 'Escape' });
    // Browsers would otherwise empty a search field and leave it open.
    expect(escape).toBe(false);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByText('Zürich HB')).toBeVisible();
    expect(bar()).toHaveFocus();
  });

  it('chooses a place from the search, closes and shows it in the bar', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([zurich])));
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    fireEvent.click(bar());
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Zürich HB' } });
    await act(async () => vi.advanceTimersByTimeAsync(350));
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(zurich);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(bar()).toHaveAccessibleName('Showing scooters near Zürich HB. Search another place.');
    expect(bar()).toHaveFocus();
  });

  it('chooses a recent place again and closes', () => {
    const onSelect = vi.fn();
    render(<Harness recentPlaces={[lungern]} onSelect={onSelect} />);

    fireEvent.click(bar());
    fireEvent.click(screen.getByRole('button', { name: 'Lungern, OW, No data' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(lungern);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('locates from the open search and closes it', () => {
    const onLocate = vi.fn();
    render(<Harness onLocate={onLocate} />);

    fireEvent.click(bar());
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(onLocate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(bar()).toHaveFocus();
  });

  it('ignores Escape while it is closed', () => {
    const onExpandedChange = vi.fn();
    render(island({ onExpandedChange }));

    fireEvent.keyDown(bar(), { key: 'Escape' });
    expect(onExpandedChange).not.toHaveBeenCalled();
  });
});
