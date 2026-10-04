// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BottomSheet from '@/components/BottomSheet';
import { dockIssue, dockModel, type DockInput } from '@/lib/dockModel';
import { I18nProvider } from '@/lib/i18n';
import { PROVIDERS, type ParkingLocation, type ScooterResponseMeta, type Vehicle } from '@/lib/types';
import { formatClockTime } from '@/lib/uiText';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const UPDATED = NOW - 30_000;
const SHOWING = formatClockTime(UPDATED, 'en');
const ZURICH = ['bolt', 'bird', 'dott', 'hopp', 'lime', 'voi', 'publibike'];

const meta = (overrides: Partial<ScooterResponseMeta> = {}): ScooterResponseMeta => ({
  partial: false, stale: false, failedSources: [], sources: {}, generatedAt: new Date(UPDATED).toISOString(),
  truncated: false, totalVehicles: 5, mode: 'vehicles', zoom: 16, ...overrides,
});

/** A healthy Zürich street with five scooters, changed by the overrides. */
function input(overrides: Partial<DockInput> = {}): DockInput {
  return {
    count: 5,
    originInViewport: false,
    loading: null,
    failure: null,
    outOfDate: false,
    hasData: true,
    meta: meta(),
    lastUpdated: UPDATED,
    now: NOW,
    representedCount: 5,
    viewportProviders: ZURICH,
    viewportCenter: [47.3769, 8.5417],
    providerCounts: { bolt: 2, lime: 3 },
    providersInView: new Set(['bolt', 'lime']),
    enabledProviders: new Set(Object.keys(PROVIDERS)),
    minBattery: 0,
    unfilteredCount: 5,
    ...overrides,
  };
}

const dock = (overrides: Partial<DockInput> = {}) => dockModel(input(overrides));
/** The dock and the line above a card, as the page derives both from one input. */
const data = (overrides: Partial<DockInput> = {}) => ({ dock: dock(overrides), issue: dockIssue(input(overrides)) });

const lime: Vehicle = {
  provider: 'lime', lat: 47.37, lng: 8.54, battery: 82, range_m: 14_000,
  vehicle_id: 'lime-1', deep_link: null, distance_m: null,
};

const bay: ParkingLocation = {
  id: 'lime:bay', provider: 'lime', name: 'Bahnhofplatz', lat: 47.377, lng: 8.54, mandatory: true,
};

function renderSheet(overrides: Partial<React.ComponentProps<typeof BottomSheet>> = {}) {
  const props: React.ComponentProps<typeof BottomSheet> = {
    ...data(),
    selectedVehicle: null,
    selectedParking: null,
    selectionAnchor: () => null,
    hidden: false,
    onShowAllProviders: vi.fn(),
    onProviderToggle: vi.fn(),
    onClearSelection: vi.fn(),
    onResetFilters: vi.fn(),
    onEditFilters: vi.fn(),
    onRetry: vi.fn(),
    onCitySelect: vi.fn(),
    onLocate: vi.fn(),
    ...overrides,
  };

  const view = render(<I18nProvider><BottomSheet {...props} /></I18nProvider>);
  return {
    ...props,
    /** Renders again with some props changed. */
    update: (changes: Partial<React.ComponentProps<typeof BottomSheet>>) =>
      view.rerender(<I18nProvider><BottomSheet {...props} {...changes} /></I18nProvider>),
  };
}

const count = () => document.querySelector('.sheet-count');
const chipNames = () => within(screen.getByRole('group', { name: 'Filter scooters by provider' }))
  .getAllByRole('button').map(chip => chip.getAttribute('aria-label'));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

describe('BottomSheet', () => {
  it('counts the scooters on this map, or nearby when the origin is in view', () => {
    renderSheet();
    expect(count()).toHaveTextContent(/^5\s*scooters on this map$/);
  });

  it('says nearby when your location or the searched place is on screen', () => {
    renderSheet({ dock: dock({ originInViewport: true }) });
    expect(count()).toHaveTextContent(/^5\s*scooters nearby$/);
  });

  it('uses the singular for one scooter', () => {
    renderSheet({ dock: dock({ count: 1, originInViewport: true, providerCounts: { lime: 1 } }) });
    expect(count()).toHaveTextContent(/^1\s*scooter nearby$/);
  });

  it('says it is finding scooters on the first load, without a count, status or chips', () => {
    renderSheet({ dock: dock({ hasData: false, loading: 'load', meta: null, lastUpdated: null }) });

    expect(count()).toHaveTextContent(/^Finding scooters…$/);
    expect(count()?.querySelector('.mini-spinner')).toBeInTheDocument();
    expect(document.querySelector('.sheet-sub')).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('waits for scooter data while the first load has failed', () => {
    renderSheet({ dock: dock({ hasData: false, failure: 'offline', meta: null, lastUpdated: null }) });

    expect(count()).toHaveTextContent(/^Waiting for scooter data$/);
    expect(count()?.querySelector('.mini-spinner')).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('marks fresh data as live with a green dot', () => {
    renderSheet();

    expect(screen.getByText('Live')).toBeVisible();
    expect(document.querySelector('.freshness-dot')).toBeInTheDocument();
    expect(screen.queryByText(/Filters active/)).not.toBeInTheDocument();
  });

  it('says how old older data is', () => {
    renderSheet({ dock: dock({ lastUpdated: NOW - 4 * 60_000 }) });

    expect(screen.getByText('Updated 4 min ago')).toBeVisible();
    expect(document.querySelector('.freshness-dot')).not.toBeInTheDocument();
  });

  it('says that data is delayed and which time it shows', () => {
    renderSheet({ dock: dock({ meta: meta({ stale: true }) }) });

    expect(screen.getByText(`Data delayed · showing ${SHOWING}`)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('describes city totals and invites a tap on a city', () => {
    renderSheet({ dock: dock({
      count: 4952,
      meta: meta({ overview: true, mode: 'clusters', zoom: 8 }),
      lastUpdated: NOW - 40 * 60_000,
      providerCounts: { voi: 1479, bird: 826 },
    }) });

    // The thousands separator of the locale, whichever apostrophe the runtime uses.
    expect(count()).toHaveTextContent(/^4[’']952\s*scooters on this map$/);
    expect(screen.getByText('City totals · refreshed hourly')).toBeVisible();
    expect(screen.queryByText(/min ago/)).not.toBeInTheDocument();
    expect(screen.getByText('Tap a city to see its scooters.')).toBeVisible();
  });

  it('reports a failed refresh in the status line and offers to try again', () => {
    const props = renderSheet({ dock: dock({ failure: 'timeout' }) });

    const status = screen.getByText(`Couldn’t refresh · showing ${SHOWING}`);
    expect(status.closest('[role="status"]')).toBeInTheDocument();
    expect(status.closest('.sheet-sub')).toHaveClass('sheet-sub-warning');
    // The scooters stay as they are.
    expect(count()).toHaveTextContent(/^5\s*scooters on this map$/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it('says so when the refresh failed because the device is offline', () => {
    renderSheet({ dock: dock({ failure: 'offline', loading: 'refresh' }) });

    expect(screen.getByText(`You’re offline · showing ${SHOWING}`)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute('aria-busy', 'true');
  });

  it('names a provider that is not sharing data, calmly, and draws its chip dashed after All', () => {
    renderSheet({ dock: dock({ meta: meta({ partial: true, failedSources: ['national:bird_zurich'] }) }) });

    const notice = screen.getByText('Bird isn’t sharing data right now.');
    expect(notice.closest('[role="status"]')).toHaveClass('dock-notes');
    const chip = screen.getByRole('button', { name: 'Bird: not sharing data right now' });
    expect(chip).toHaveClass('chip-down');
    expect(chip).not.toHaveClass('chip-selected');
    expect(chip.querySelector('.chip-warning')).toBeInTheDocument();
    expect(chip.querySelector('.chip-count')).not.toBeInTheDocument();
    expect(chipNames().slice(0, 2)).toEqual(['All providers, 5. Show all.', 'Bird: not sharing data right now']);
  });

  it('lists the other notices one line each', () => {
    renderSheet({ dock: dock({
      representedCount: 2000,
      meta: meta({ failedSources: ['hopp', 'national:bird_zurich'], truncated: true, totalVehicles: 5412, parkingStatus: 'stale' }),
    }) });

    const notes = [...document.querySelectorAll('.dock-notes .dock-note')].map(note => note.textContent);
    expect(notes).toEqual([
      'Bird and Hopp aren’t sharing data right now.',
      expect.stringMatching(/^Showing 2[’']000 of 5[’']412 — zoom in to see all$/),
      'Parking bays may be out of date',
    ]);
  });

  it('orders the provider chips by their count, most first', () => {
    renderSheet({ dock: dock({ providerCounts: { bolt: 2, lime: 7, voi: 6, hopp: 4 }, count: 19 }) });

    expect(chipNames()).toEqual([
      'All providers, 19. Show all.',
      'Lime, 7. Shown.',
      'Voi, 6. Shown.',
      'Hopp, 4. Shown.',
      'Bolt, 2. Shown.',
      'Bird, 0. Shown.',
      'Dott, 0. Shown.',
      'PubliBike / Velospot, 0. Shown.',
    ]);
  });

  it('only offers providers in the current area without changing the saved selection', () => {
    const enabledProviders = new Set(Object.keys(PROVIDERS));
    renderSheet({ dock: dock({ enabledProviders, viewportProviders: ['dott'], providerCounts: { dott: 3 }, count: 3 }) });

    expect(screen.getByRole('button', { name: /^Dott, 3/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^PubliBike/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Hopp,/ })).not.toBeInTheDocument();
    expect(enabledProviders.has('publibike')).toBe(true);
  });

  it('supports explicit All and individual provider toggles', () => {
    const props = renderSheet({ dock: dock({ enabledProviders: new Set(['lime']), count: 3 }) });

    expect(screen.getByRole('button', { name: 'Lime, 3. Shown.' })).toHaveClass('chip-selected');
    expect(screen.getByRole('button', { name: 'Bolt, 2. Hidden.' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: /^All providers/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Bolt,/ }));

    expect(props.onShowAllProviders).toHaveBeenCalledOnce();
    expect(props.onProviderToggle).toHaveBeenCalledWith('bolt');
  });

  it('says that a covered area is empty and what to do about it', () => {
    renderSheet({ dock: dock({ count: 0, providerCounts: {}, unfilteredCount: 0 }) });

    expect(count()).toHaveTextContent(/^0\s*scooters on this map$/);
    expect(screen.getByText('No scooters here right now. Zoom out or move the map.').closest('[role="status"]'))
      .toHaveClass('dock-hint');
    expect(screen.getByRole('group', { name: 'Filter scooters by provider' })).toBeVisible();
  });

  it('replaces count and chips with the out-of-date card, whose button tries again', () => {
    const props = renderSheet({ dock: dock({ outOfDate: true, hasData: false, failure: 'offline', count: 0 }) });

    expect(screen.getByRole('heading', { name: 'These positions are out of date' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(`Last update ${SHOWING}. You’re offline. Check your connection.`);
    expect(count()).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });

  it('offers the closest cities where no provider operates', () => {
    const props = renderSheet({ dock: dock({
      count: 0, providerCounts: {}, unfilteredCount: 0, viewportProviders: [], viewportCenter: [46.7741, 8.1558],
    }) });

    expect(screen.getByRole('heading', { name: 'No scooter data here yet' })).toBeVisible();
    expect(screen.getByText('Scooters covers selected cities in France, Switzerland, Germany and Italy.')).toBeVisible();
    expect(count()).not.toBeInTheDocument();
    const cities = within(screen.getByRole('group', { name: 'Closest cities' })).getAllByRole('button');
    expect(cities).toHaveLength(3);
    expect(cities[0]).toHaveTextContent(/^Zug · 52 km$/);
    fireEvent.click(cities[0]);
    expect(props.onCitySelect).toHaveBeenCalledWith(expect.objectContaining({ city: 'Zug', id: 'ch:zug' }));
  });

  it('says how many scooters the filters hide and offers to show them or edit the filters', () => {
    const props = renderSheet({ dock: dock({
      count: 0, enabledProviders: new Set(['lime']), minBattery: 60, providerCounts: {}, unfilteredCount: 26,
    }) });

    expect(screen.getByRole('heading', { name: '26 scooters hidden by your filters' })).toBeVisible();
    expect(screen.getByText('Lime only · battery 60% or more')).toBeVisible();
    expect(count()).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 26' }));
    expect(props.onResetFilters).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Edit filters' }));
    expect(props.onEditFilters).toHaveBeenCalledOnce();
  });

  it('does not invent a number when the hidden count is not known', () => {
    renderSheet({ dock: dock({ count: 0, minBattery: 80, providerCounts: {}, unfilteredCount: null }) });

    expect(screen.getByRole('heading', { name: 'No scooters match your filters here' })).toBeVisible();
    expect(screen.getByText('Battery 80% or more')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show all' })).toBeVisible();
  });

  it('does not say "Show all 1" for a single hidden scooter', () => {
    renderSheet({ dock: dock({ count: 0, minBattery: 80, providerCounts: {}, unfilteredCount: 1 }) });

    expect(screen.getByRole('heading', { name: '1 scooter hidden by your filters' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show all' })).toBeVisible();
  });

  it('shows only the card while a scooter is selected', () => {
    const props = renderSheet({ selectedVehicle: { vehicle: lime, walk: null } });

    expect(screen.getByRole('heading', { name: 'Lime' })).toBeVisible();
    expect(count()).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filter scooters by provider' })).not.toBeInTheDocument();
    expect(document.querySelector('.dock-issue')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close scooter details' }));
    expect(props.onClearSelection).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on location to see walking time' }));
    expect(props.onLocate).toHaveBeenCalledOnce();
  });

  it('keeps a failed refresh in view above the card, with the same way to try again', () => {
    const props = renderSheet({
      ...data({ failure: 'unavailable' }),
      selectedVehicle: { vehicle: lime, walk: { distanceM: 126, place: null } },
    });

    const issue = screen.getByRole('status');
    expect(issue).toHaveClass('dock-issue');
    expect(issue).toHaveTextContent(`Couldn’t refresh · showing ${SHOWING}`);
    const retry = within(issue).getByRole('button', { name: 'Try again' });
    // The same pill as in the dock header.
    expect(retry).toHaveClass('dock-retry');
    fireEvent.click(retry);
    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Lime' })).toBeVisible();
  });

  it('keeps delayed data in view above the card, without a button', () => {
    renderSheet({
      ...data({ meta: meta({ stale: true }) }),
      selectedVehicle: { vehicle: lime, walk: null },
    });

    const issue = screen.getByRole('status');
    expect(issue).toHaveTextContent(`Data delayed · showing ${SHOWING}`);
    expect(within(issue).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows only the card while a parking bay is selected', () => {
    const props = renderSheet({ selectedParking: { parking: bay, walk: { distanceM: 150, place: null } } });

    expect(screen.getByRole('heading', { name: 'Lime parking bay' })).toBeVisible();
    expect(document.querySelector('.card-title p')).toHaveTextContent(/^Bahnhofplatz · ≈2 min walk$/);
    expect(count()).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filter scooters by provider' })).not.toBeInTheDocument();
    expect(document.querySelector('.dock-issue')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close parking details' }));
    expect(props.onClearSelection).toHaveBeenCalledOnce();
  });

  it('shows a selected bay instead of the card that says the filters hide every scooter', () => {
    renderSheet({
      ...data({ count: 0, minBattery: 80, providerCounts: {}, unfilteredCount: 26 }),
      selectedParking: { parking: bay, walk: null },
    });

    expect(screen.getByRole('heading', { name: 'Lime parking bay' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: /hidden by your filters/ })).not.toBeInTheDocument();
  });

  it('keeps a failed refresh in view above the bay as well', () => {
    const props = renderSheet({
      ...data({ failure: 'offline' }),
      selectedParking: { parking: bay, walk: null },
    });

    const issue = screen.getByRole('status');
    expect(issue).toHaveClass('dock-issue');
    expect(issue).toHaveTextContent(`You’re offline · showing ${SHOWING}`);
    fireEvent.click(within(issue).getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Lime parking bay' })).toBeVisible();
  });

  it('moves the focus into the card when it opens, and back to the marker when it closes with the focus inside', () => {
    const marker = document.body.appendChild(document.createElement('button'));
    const other = document.body.appendChild(document.createElement('button'));
    const selectionAnchor = () => marker;
    marker.focus();
    const sheet = renderSheet({ selectionAnchor });
    expect(marker).toHaveFocus();

    // Named like the card beside a marker on a desktop, and announced when the focus arrives.
    sheet.update({ selectedVehicle: { vehicle: lime, walk: null } });
    const card = screen.getByRole('group', { name: 'Lime scooter' });
    expect(card).toHaveFocus();
    expect(within(card).getByRole('heading', { name: 'Lime' })).toBeVisible();

    // Closed from inside, with the close button: back to where the visitor was on the map.
    screen.getByRole('button', { name: 'Close scooter details' }).focus();
    sheet.update({ selectedVehicle: null });
    expect(marker).toHaveFocus();

    // A bay is named as a bay. Closed while the focus is elsewhere, the focus stays there.
    sheet.update({ selectedParking: { parking: bay, walk: null } });
    expect(screen.getByRole('group', { name: 'Lime parking bay' })).toHaveFocus();
    other.focus();
    sheet.update({ selectedParking: null });
    expect(other).toHaveFocus();
    marker.remove();
    other.remove();
  });

  it('does not take the focus again while the same card stays open', () => {
    const sheet = renderSheet({ selectedVehicle: { vehicle: lime, walk: null } });
    const close = screen.getByRole('button', { name: 'Close scooter details' });
    close.focus();
    // New data for the same scooter, a walking time that arrives: the card is drawn again.
    sheet.update({ selectedVehicle: { vehicle: { ...lime, battery: 81 }, walk: { distanceM: 80, place: null } } });
    expect(screen.getByRole('button', { name: 'Close scooter details' })).toHaveFocus();
  });

  it('makes the dock inert while searching', () => {
    renderSheet({ hidden: true });

    const sheet = document.querySelector('.sheet');
    expect(sheet).toHaveAttribute('inert');
    expect(sheet).toHaveAttribute('aria-hidden', 'true');
  });

  describe('on a desktop', () => {
    it('lists the providers one under the other, most scooters first, without "All"', () => {
      renderSheet({ desktop: true, dock: dock({ providerCounts: { bolt: 2, lime: 7, voi: 6, hopp: 4 }, count: 19 }) });

      expect(screen.getByRole('group', { name: 'Filter scooters by provider' })).toHaveClass('legend');
      expect(chipNames()).toEqual([
        'Lime, 7. Shown.',
        'Voi, 6. Shown.',
        'Hopp, 4. Shown.',
        'Bolt, 2. Shown.',
        'Bird, 0. Shown.',
        'Dott, 0. Shown.',
        'PubliBike / Velospot, 0. Shown.',
      ]);
      const lime = screen.getByRole('button', { name: 'Lime, 7. Shown.' });
      expect(lime.querySelector('.legend-name')).toHaveTextContent('Lime');
      expect(lime.querySelector('.legend-count')).toHaveTextContent('7');
      expect(lime.querySelector('.legend-check svg')).toBeInTheDocument();
      // The count and the status stay above the legend.
      expect(count()).toHaveTextContent(/^19\s*scooters on this map$/);
      expect(screen.getByText('Live')).toBeVisible();
    });

    it('marks a row as shown with a check and toggles a provider like its chip', () => {
      const props = renderSheet({ desktop: true, dock: dock({ enabledProviders: new Set(['lime']), count: 3 }) });

      const lime = screen.getByRole('button', { name: 'Lime, 3. Shown.' });
      const bolt = screen.getByRole('button', { name: 'Bolt, 2. Hidden.' });
      expect(lime).toHaveAttribute('aria-pressed', 'true');
      expect(lime.querySelector('.legend-check svg')).toBeInTheDocument();
      expect(bolt).toHaveAttribute('aria-pressed', 'false');
      expect(bolt.querySelector('.legend-check svg')).not.toBeInTheDocument();
      // A hidden provider keeps its count: it says what switching it on would add.
      expect(bolt.querySelector('.legend-count')).toHaveTextContent('2');

      fireEvent.click(bolt);
      expect(props.onProviderToggle).toHaveBeenCalledWith('bolt');
      expect(props.onShowAllProviders).not.toHaveBeenCalled();
    });

    it('puts a provider that is not sharing data first, with a warning in place of its count and no check', () => {
      renderSheet({ desktop: true, dock: dock({ meta: meta({ partial: true, failedSources: ['national:bird_zurich'] }) }) });

      expect(screen.getByText('Bird isn’t sharing data right now.')).toBeVisible();
      expect(chipNames()[0]).toBe('Bird: not sharing data right now');
      const bird = screen.getByRole('button', { name: 'Bird: not sharing data right now' });
      expect(bird).toHaveClass('legend-down');
      expect(bird.querySelector('.chip-warning')).toBeInTheDocument();
      expect(bird.querySelector('.legend-count')).not.toBeInTheDocument();
      expect(bird.querySelector('.legend-check svg')).not.toBeInTheDocument();
    });

    it('keeps the count, the status and the providers while a scooter or a bay is selected', () => {
      // Their card opens beside the marker, so the dock has nothing to replace.
      renderSheet({ desktop: true, selectedVehicle: { vehicle: lime, walk: null } });

      expect(count()).toHaveTextContent(/^5\s*scooters on this map$/);
      expect(screen.getByRole('group', { name: 'Filter scooters by provider' })).toBeInTheDocument();
      expect(document.querySelector('.dock-card')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Close scooter details' })).not.toBeInTheDocument();
    });

    it('keeps a failed refresh in its status line while a bay is selected, with Try again', () => {
      const props = renderSheet({
        desktop: true,
        ...data({ failure: 'unavailable' }),
        selectedParking: { parking: bay, walk: null },
      });

      expect(screen.getByText(`Couldn’t refresh · showing ${SHOWING}`)).toBeVisible();
      expect(document.querySelector('.dock-issue')).not.toBeInTheDocument();
      expect(document.querySelector('.dock-card')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(props.onRetry).toHaveBeenCalledOnce();
    });

    it('still replaces the count with the card that explains why there is nothing to show', () => {
      renderSheet({ desktop: true, dock: dock({ outOfDate: true, failure: 'offline' }) });

      expect(count()).not.toBeInTheDocument();
      expect(screen.queryByRole('group')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'These positions are out of date' })).toBeVisible();
    });
  });
});
