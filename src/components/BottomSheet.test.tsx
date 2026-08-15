// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BottomSheet from '@/components/BottomSheet';
import { I18nProvider } from '@/lib/i18n';
import { PROVIDERS } from '@/lib/types';

let desktopPanel = false;

function renderSheet(overrides: Partial<React.ComponentProps<typeof BottomSheet>> = {}) {
  const props: React.ComponentProps<typeof BottomSheet> = {
    minBattery: 0,
    enabledProviders: new Set(Object.keys(PROVIDERS)),
    providerCounts: { bolt: 2, lime: 3 },
    totalCount: 5,
    loading: false,
    lastUpdated: null,
    dataHealthNotice: null,
    tileLayer: 'light',
    selectedVehicle: null,
    onMinBatteryChange: vi.fn(),
    onAddressSelect: vi.fn(),
    onAddressClear: vi.fn(),
    onShowAllProviders: vi.fn(),
    onProviderToggle: vi.fn(),
    onTileLayerChange: vi.fn(),
    onExpandedChange: vi.fn(),
    onClearSelection: vi.fn(),
    onResetFilters: vi.fn(),
    ...overrides,
  };

  render(<I18nProvider><BottomSheet {...props} /></I18nProvider>);
  return props;
}

beforeEach(() => {
  desktopPanel = false;
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: desktopPanel,
    media: '(min-width: 900px)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

describe('BottomSheet', () => {
  it('keeps collapsed controls inert until keyboard expansion', () => {
    const onExpandedChange = vi.fn();
    renderSheet({ onExpandedChange });

    const body = document.querySelector('#scooter-controls-body');
    const handle = screen.getByRole('button', { name: 'Expand controls' });
    expect(body).toHaveAttribute('inert');

    handle.focus();
    fireEvent.keyDown(handle, { key: 'Enter' });

    expect(handle).toHaveFocus();
    expect(body).not.toHaveAttribute('inert');
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it('keeps address search inside the bottom sheet and omits the nearby list', () => {
    renderSheet();

    const body = document.querySelector('#scooter-controls-body');
    const search = screen.getByRole('combobox', { name: 'Search a Swiss address' });
    expect(body).toContainElement(search);
    expect(screen.queryByText('Nearby scooters')).not.toBeInTheDocument();
  });

  it('shows feed metadata as an accessible status', () => {
    renderSheet({ dataHealthNotice: 'Some providers unavailable' });

    expect(screen.getByRole('status')).toHaveTextContent('Some providers unavailable');
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

  it('leaves the body active and removes drawer semantics on wide screens', () => {
    desktopPanel = true;
    renderSheet();

    expect(screen.queryByRole('button', { name: 'Expand controls' })).not.toBeInTheDocument();
    expect(document.querySelector('#scooter-controls-body')).not.toHaveAttribute('inert');
  });

  it('links to the privacy notice and named public data sources', () => {
    renderSheet();

    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Mobility data' })).toHaveAttribute(
      'href',
      'https://opentransportdata.swiss/en/cookbook/shared-mobility/'
    );
    expect(screen.getByRole('link', { name: 'Address data © swisstopo' })).toHaveAttribute(
      'href',
      'https://www.geo.admin.ch/en/geo-services/geo-services/application-programming-interface-api'
    );
  });
});
