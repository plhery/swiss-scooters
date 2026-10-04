// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SearchIsland from '@/components/SearchIsland';
import { I18nProvider } from '@/lib/i18n';

const place = { lat: 46.7741, lng: 8.1558, display_name: 'Lungern, OW' };

function renderIsland(overrides: Partial<React.ComponentProps<typeof SearchIsland>> = {}) {
  render(
    <I18nProvider>
      <SearchIsland
        address={null}
        placeHasData
        hasLocation={false}
        expanded={false}
        hasActiveFilters={false}
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

beforeEach(() => {
  localStorage.setItem('scooters-locale', 'en');
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

describe('SearchIsland', () => {
  it('says that the scooters are near the searched place', () => {
    renderIsland({ address: place });

    expect(screen.getByText('Lungern')).toBeVisible();
    expect(screen.getByText('Scooters near this place')).toBeVisible();
  });

  it('does not promise scooters near a place that has no scooter data', () => {
    renderIsland({ address: place, placeHasData: false });

    expect(screen.getByText('Lungern')).toBeVisible();
    expect(screen.queryByText('Scooters near this place')).not.toBeInTheDocument();
    expect(screen.getByText('Tap to search a city or address')).toBeVisible();
  });

  it('keeps its usual line while no place is chosen, whatever the dock shows', () => {
    renderIsland({ placeHasData: false });

    expect(screen.queryByText('Tap to search a city or address')).not.toBeInTheDocument();
    expect(screen.getByText('Search or change origin')).toBeVisible();
  });
});
