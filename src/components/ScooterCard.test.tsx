// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ScooterCard, { type SelectedVehicle } from '@/components/ScooterCard';
import { I18nProvider } from '@/lib/i18n';
import type { Vehicle } from '@/lib/types';

const lime: Vehicle = {
  provider: 'lime', lat: 47.37, lng: 8.54, battery: 82, range_m: 24_000,
  vehicle_id: 'lime-1', deep_link: null, distance_m: null,
  rental_uris: { ios: 'https://li.me/ride', android: 'https://li.me/ride', web: 'https://li.me/ride' },
  pricing: { currency: 'CHF', unlock_fee_minor_units: 100, minute_fee_minor_units: 35 },
};

function renderCard(selection: Partial<SelectedVehicle> = {}, vehicle: Partial<Vehicle> = {}, locating = false) {
  const props = {
    selection: { vehicle: { ...lime, ...vehicle }, walk: { distanceM: 126, place: null }, ...selection },
    onClose: vi.fn(),
    onLocate: vi.fn(),
  };
  const card = (isLocating: boolean) => <I18nProvider><ScooterCard {...props} locating={isLocating} /></I18nProvider>;
  const view = render(card(locating));
  return { ...props, setLocating: (isLocating: boolean) => view.rerender(card(isLocating)) };
}

beforeEach(() => {
  localStorage.clear();
});

describe('ScooterCard', () => {
  it('names the provider and says how long the walk is', () => {
    renderCard();

    expect(screen.getByRole('heading', { name: 'Lime' })).toBeVisible();
    expect(screen.getByText('≈2 min walk · 126 m')).toBeVisible();
  });

  it('says where the walk starts when the origin is a searched place', () => {
    renderCard({ walk: { distanceM: 320, place: 'Zürich HB' } });

    expect(screen.getByText('≈4 min walk from Zürich HB · 320 m')).toBeVisible();
  });

  it('offers to locate instead of inventing a walking time without an origin', () => {
    const props = renderCard({ walk: null });

    expect(screen.queryByText(/min walk/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on location to see walking time' }));
    expect(props.onLocate).toHaveBeenCalledOnce();
  });

  it('says that the location is on its way instead of offering to locate a second time', () => {
    const props = renderCard({ walk: null });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on location to see walking time' }));
    expect(props.onLocate).toHaveBeenCalledOnce();

    // Up to ten seconds for a fix: the link is gone, so a second request cannot be started.
    props.setLocating(true);
    expect(screen.queryByRole('button', { name: 'Turn on location to see walking time' })).not.toBeInTheDocument();
    const line = screen.getByText('Finding your location…');
    expect(line).toBeVisible();
    expect(line.querySelector('.mini-spinner')).toBeInTheDocument();
    expect(props.onLocate).toHaveBeenCalledOnce();

    // No fix after all: the offer is back.
    props.setLocating(false);
    expect(screen.getByRole('button', { name: 'Turn on location to see walking time' })).toBeVisible();
  });

  it('shows the walking time of a known origin also while another fix is on its way', () => {
    renderCard({}, {}, true);

    expect(screen.getByText('≈2 min walk · 126 m')).toBeVisible();
    expect(screen.queryByText('Finding your location…')).not.toBeInTheDocument();
  });

  it('names the battery and the range for a screen reader, which the icons do not', () => {
    renderCard();

    // Read as "Battery 82%" and "Range 24 km": without the words, "24 km" follows the walking distance unexplained.
    expect(screen.getByText('82%')).toHaveTextContent(/^Battery 82%$/);
    expect(screen.getByText('24 km')).toHaveTextContent(/^Range 24 km$/);
    expect(screen.getByText('Battery')).toHaveClass('sr-only');
    expect(screen.getByText('Range')).toHaveClass('sr-only');
  });

  it.each([['de', 'Akku 82%', 'Reichweite 24 km'], ['fr', 'Batterie 82%', 'Autonomie 24 km'], ['it', 'Batteria 82%', 'Autonomia 24 km']])(
    'names them in %s',
    async (locale, battery, range) => {
      localStorage.setItem('scooters-locale', locale);
      renderCard();

      expect(await screen.findByText(battery.split(' ')[0])).toHaveClass('sr-only');
      expect(screen.getByText('82%')).toHaveTextContent(battery);
      expect(screen.getByText('24 km')).toHaveTextContent(range);
    }
  );

  it.each([
    [82, 'pill-good'],
    [50, 'pill-good'],
    [49, 'pill-low'],
    [20, 'pill-low'],
    [19, 'pill-critical'],
    [0, 'pill-critical'],
  ])('shows a battery of %i%% with its number, coloured as %s', (battery, level) => {
    renderCard({}, { battery });

    expect(screen.getByText(`${battery}%`)).toHaveClass('pill', level);
  });

  it('leaves out what the provider does not say', () => {
    renderCard({}, { battery: null, range_m: null });

    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/km$/)).not.toBeInTheDocument();
  });

  it('shows the range', () => {
    renderCard();

    expect(screen.getByText('24 km')).toHaveClass('pill');
  });

  it('says that the price is in the provider app when there is no tariff', () => {
    renderCard({}, { pricing: undefined });

    expect(screen.getByText('Price shown in the Lime app')).toHaveClass('pill');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('opens the provider app with the app’s blue button, next to directions', () => {
    renderCard();

    expect(screen.getByRole('link', { name: 'Directions' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&destination=47.37%2C8.54&travelmode=walking'
    );
    const open = screen.getByRole('link', { name: 'Open in Lime' });
    expect(open).toHaveAttribute('href', 'https://li.me/ride');
    expect(open).toHaveClass('card-action-primary');
    expect(screen.getByText('Opens the Lime app. It won’t reserve the scooter.')).toBeVisible();
  });

  it('leaves directions alone when there is no way to open the provider app', () => {
    renderCard({}, { rental_uris: undefined });

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Directions' })).toBeVisible();
    expect(screen.getByText('Open the Lime app to rent this scooter.')).toBeVisible();
  });

  it('closes from its own button', () => {
    const props = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Close scooter details' }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('estimates the ride for the chosen duration and remembers the choice on this device', () => {
    renderCard();

    // One franc to unlock and 35 centimes a minute.
    expect(screen.getByText(/for 10 min/)).toHaveTextContent('≈ CHF 4.50 for 10 min');
    const picker = screen.getByRole('combobox', { name: 'Ride estimate, 10 minutes. Change duration.' });
    expect(within(picker).getAllByRole('option').map(option => option.textContent))
      .toEqual(['5 min', '10 min', '15 min', '20 min', '30 min']);

    try {
      fireEvent.change(picker, { target: { value: '20' } });
      expect(screen.getByText(/for 20 min/)).toHaveTextContent('≈ CHF 8.00 for 20 min');
      expect(screen.getByRole('combobox', { name: 'Ride estimate, 20 minutes. Change duration.' })).toHaveValue('20');
      expect(localStorage.getItem('scooters-ride-minutes')).toBe('20');
    } finally {
      // The choice is shared by every card on the page; put it back for the other tests.
      fireEvent.change(picker, { target: { value: '10' } });
    }
  });
});
