// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BottomSheet from '@/components/BottomSheet';
import { I18nProvider } from '@/lib/i18n';
import { PROVIDERS } from '@/lib/types';


function renderSheet(overrides: Partial<React.ComponentProps<typeof BottomSheet>> = {}) {
  const props: React.ComponentProps<typeof BottomSheet> = {
    minBattery: 0,
    enabledProviders: new Set(Object.keys(PROVIDERS)),
    providerCounts: { bolt: 2, lime: 3 },
    totalCount: 5,
    loading: false,
    lastUpdated: null,
    dataHealthNotice: null,
    hidden: false,
    availableProviders: Object.keys(PROVIDERS),
    selectedVehicle: null,
    onShowAllProviders: vi.fn(),
    onProviderToggle: vi.fn(),
    onClearSelection: vi.fn(),
    onResetFilters: vi.fn(),
    ...overrides,
  };

  render(<I18nProvider><BottomSheet {...props} /></I18nProvider>);
  return props;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    media: '(min-width: 900px)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

describe('BottomSheet', () => {
  it('only offers providers in the current area without changing the saved selection', () => {
    const enabledProviders = new Set(Object.keys(PROVIDERS));
    renderSheet({ enabledProviders, availableProviders: ['dott'], providerCounts: { dott: 3 } });
    expect(screen.getByRole('button', { name: /^Dott, 3/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^PubliBike,/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Hopp,/ })).not.toBeInTheDocument();
    expect(enabledProviders.has('publibike')).toBe(true);
  });
  it('makes the dock inert while searching', () => {
    renderSheet({ hidden: true });
    const dock = document.querySelector('.sheet');
    expect(dock).toHaveAttribute('inert');
    expect(dock).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps provider shortcuts available with selected scooter details', () => {
    renderSheet({ selectedVehicle: {
      vehicle: { provider: 'lime', lat: 47.37, lng: 8.54, battery: 82, range_m: 14000,
        vehicle_id: 'lime-1', deep_link: null, distance_m: 0 },
      distanceM: null,
    } });
    expect(screen.getByRole('button', { name: /^Bolt,/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close scooter details' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Walk there' })).toHaveAttribute('href', expect.stringContaining('travelmode=walking'));
    expect(document.querySelector('.walking-summary')).not.toBeInTheDocument();
  });

  it('shows feed metadata as an accessible status', () => {
    renderSheet({ dataHealthNotice: 'Some providers unavailable' });

    expect(screen.getByRole('status')).toHaveTextContent('Some providers unavailable');
  });

  it('shows fresh data in human terms', () => {
    renderSheet({ lastUpdated: new Date() });

    expect(screen.getByText('Just now')).toBeVisible();
    expect(document.querySelector('.freshness-dot')).toBeInTheDocument();
  });

  it('offers an immediate recovery when filters hide every scooter', () => {
    const onResetFilters = vi.fn();
    renderSheet({
      minBattery: 80,
      totalCount: 0,
      providerCounts: {},
      onResetFilters,
    });

    const emptyStatus = screen.getByRole('status');
    expect(emptyStatus).toHaveTextContent(
      'No scooters match these filters here.'
    );
    fireEvent.click(within(emptyStatus).getByRole('button', { name: 'Reset filters' }));
    expect(onResetFilters).toHaveBeenCalledOnce();
  });

  it('supports explicit All and individual provider toggles', () => {
    const onShowAllProviders = vi.fn();
    const onProviderToggle = vi.fn();
    renderSheet({ onShowAllProviders, onProviderToggle });

    fireEvent.click(screen.getByRole('button', { name: /^All providers/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Bolt,/ }));

    expect(onShowAllProviders).toHaveBeenCalledOnce();
    expect(onProviderToggle).toHaveBeenCalledWith('bolt');
  });

});
