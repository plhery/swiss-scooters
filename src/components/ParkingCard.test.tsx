// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ParkingCard, { type SelectedParking } from '@/components/ParkingCard';
import { I18nProvider } from '@/lib/i18n';
import type { ParkingLocation } from '@/lib/types';

const bay: ParkingLocation = {
  id: 'dott:faidherbe', provider: 'dott', name: 'Rue Faidherbe', lat: 50.6365, lng: 3.0635, mandatory: true,
};

function renderCard(selection: Partial<SelectedParking> = {}, parking: Partial<ParkingLocation> = {}) {
  const props = {
    selection: { parking: { ...bay, ...parking }, walk: { distanceM: 210, place: null }, ...selection },
    onClose: vi.fn(),
  };
  render(<I18nProvider><ParkingCard {...props} /></I18nProvider>);
  return props;
}

/** The line under the title: the name of the bay, then the walk. */
const where = () => document.querySelector('.card-title p');

beforeEach(() => {
  localStorage.clear();
});

describe('ParkingCard', () => {
  it('says whose bay it is, where it is and how long the walk is', () => {
    renderCard();

    expect(screen.getByRole('heading', { name: 'Dott parking bay' })).toBeVisible();
    expect(where()).toHaveTextContent(/^Rue Faidherbe · ≈3 min walk$/);
  });

  it('shows the name alone without an origin', () => {
    renderCard({ walk: null });

    expect(where()).toHaveTextContent(/^Rue Faidherbe$/);
  });

  it('says where the walk starts when the origin is a searched place', () => {
    renderCard({ walk: { distanceM: 320, place: 'Lille Flandres' } });

    expect(where()).toHaveTextContent(/^Rue Faidherbe · ≈4 min walk from Lille Flandres$/);
  });

  it('shows the walk alone for a bay without a name', () => {
    renderCard({}, { name: '' });

    expect(where()).toHaveTextContent(/^≈3 min walk$/);
  });

  it('has no second line for a bay without a name or an origin', () => {
    renderCard({ walk: null }, { name: ' ' });

    expect(where()).not.toBeInTheDocument();
  });

  it('warns that parking in a bay is required in this zone', () => {
    renderCard();

    expect(screen.getByText('You must park in a bay in this zone.').closest('.bay-notice'))
      .toHaveClass('bay-notice-required');
  });

  it('describes an optional bay in a neutral tone', () => {
    renderCard({}, { mandatory: false });

    const notice = screen.getByText('Designated scooter parking.').closest('.bay-notice');
    expect(notice).toBeVisible();
    expect(notice).not.toHaveClass('bay-notice-required');
  });

  it('offers walking directions as its one, primary action and says to check the provider app', () => {
    renderCard();

    expect(screen.getAllByRole('link')).toHaveLength(1);
    const directions = screen.getByRole('link', { name: 'Directions' });
    expect(directions).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&destination=50.6365%2C3.0635&travelmode=walking'
    );
    expect(directions).toHaveClass('card-action-primary');
    expect(screen.getByText('Check the Dott app before you end your ride.')).toBeVisible();
  });

  it('closes from its own button', () => {
    const props = renderCard();

    fireEvent.click(screen.getByRole('button', { name: 'Close parking details' }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
