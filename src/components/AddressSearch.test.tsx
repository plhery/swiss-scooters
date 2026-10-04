// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddressSearch from '@/components/AddressSearch';
import { COVERED_CITIES } from '@/lib/coveredCities';
import { I18nProvider } from '@/lib/i18n';
import type { Place } from '@/lib/places';

// The answer of /api/geocode to "Paradeplatz": the places with scooter data first.
const PARADEPLATZ = [
  { lat: 47.369, lng: 8.539, display_name: 'Paradeplatz (ZH) - Zürich', title: 'Paradeplatz', subtitle: 'Zürich ZH', covered: true },
  { lat: 47.3695, lng: 8.5389, display_name: 'Paradeplatz 2 8001 Zürich', title: 'Paradeplatz 2', subtitle: '8001 Zürich', covered: true },
  { lat: 46.7741, lng: 8.1558, display_name: 'Paradeplatz (OW) - Lungern', title: 'Paradeplatz', subtitle: 'Lungern OW', covered: false },
];
const lille: Place = { lat: 50.6292, lng: 3.0573, display_name: 'Lille, France', title: 'Lille', subtitle: 'France', covered: true };
const lungern: Place = { lat: 46.7741, lng: 8.1558, display_name: 'Lungern, OW', title: 'Lungern', subtitle: 'OW', covered: false };

function renderSearch(overrides: Partial<React.ComponentProps<typeof AddressSearch>> = {}) {
  const props = { onSelect: vi.fn(), onLocate: vi.fn(), onCancel: vi.fn() };
  render(
    <I18nProvider>
      <AddressSearch recentPlaces={[]} nearbyCities={[]} {...props} {...overrides} />
    </I18nProvider>
  );
  return { ...props, input: screen.getByRole('combobox', { name: 'City or address' }) };
}

const answer = (rows: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(rows), { status }));

/** Types into the field and lets the search answer. */
async function type(input: HTMLElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
  await act(async () => vi.advanceTimersByTimeAsync(350));
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem('scooters-locale', 'en');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('with nothing typed', () => {
  it('starts on the empty field with Cancel beside it, and offers your location', () => {
    const { input, onLocate, onCancel } = renderSearch();

    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    // Neither a title nor a shortcut to the filters.
    expect(screen.queryByRole('heading')).toBeNull();
    // Nothing to report yet; the place for it is there for screen readers.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Filters' })).toBeNull();
    // Nothing chosen during this visit and no city to offer: no empty sections.
    expect(screen.queryByText('Recent')).toBeNull();
    expect(screen.queryByText('Cities with scooters')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(onLocate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('lists the places chosen earlier and chooses one again', () => {
    const { onSelect } = renderSearch({ recentPlaces: [lille, lungern] });

    const rows = within(screen.getByRole('group', { name: 'Recent' })).getAllByRole('button');
    // A place without scooter data says so here as well.
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual(['Lille, France', 'Lungern, OW, No data']);
    expect(within(rows[0]).getByText('France')).toBeVisible();
    expect(within(rows[0]).queryByText('No data')).toBeNull();
    expect(within(rows[1]).getByText('No data')).toBeVisible();

    fireEvent.click(rows[0]);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(lille);
  });

  it('offers the cities with scooters as chips, and a chip chooses the city as a place', () => {
    const cities = COVERED_CITIES.filter(city => ['ch:zurich', 'fr:Lyon'].includes(city.id));
    const { onSelect } = renderSearch({ nearbyCities: cities });

    const chips = within(screen.getByRole('group', { name: 'Cities with scooters' })).getAllByRole('button');
    expect(chips.map(chip => chip.textContent)).toEqual(['Zürich', 'Lyon']);

    fireEvent.click(chips[1]);
    const lyon = cities[1];
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      lat: lyon.center[0], lng: lyon.center[1], display_name: 'Lyon, France',
      title: 'Lyon', subtitle: 'France', covered: true, city: true,
    });
  });
});

describe('typing', () => {
  it('waits for two characters before it searches', async () => {
    const fetcher = answer(PARADEPLATZ);
    vi.stubGlobal('fetch', fetcher);
    const { input } = renderSearch({ recentPlaces: [lille] });

    await type(input, ' P ');
    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Recent' })).toBeVisible();

    fireEvent.change(input, { target: { value: 'Pa' } });
    // Searching replaces the suggestions at once, before the request leaves.
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
    expect(screen.queryByRole('group', { name: 'Recent' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use my location' })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/geocode', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ q: 'Pa', lang: 'en' }),
      cache: 'no-store',
    }));
  });

  it('shows each place with a title and a second line, and tags the ones without scooter data', async () => {
    vi.stubGlobal('fetch', answer(PARADEPLATZ));
    const { input } = renderSearch();
    await type(input, 'Paradeplatz');

    const options = within(screen.getByRole('listbox', { name: 'Suggestions' })).getAllByRole('option');
    expect(options.map(option => option.getAttribute('aria-label'))).toEqual([
      'Paradeplatz, Zürich ZH', 'Paradeplatz 2, 8001 Zürich', 'Paradeplatz, Lungern OW, No data',
    ]);
    expect(within(options[1]).getByText('Paradeplatz 2')).toBeVisible();
    expect(within(options[1]).getByText('8001 Zürich')).toBeVisible();
    // Only the place no operator serves is tagged, and its symbol is neutral.
    expect(screen.getAllByText('No data')).toHaveLength(1);
    expect(within(options[2]).getByText('No data')).toBeVisible();
    expect(options[2].querySelector('.place-tile')).toHaveClass('place-tile-muted');
    expect(options[0].querySelector('.place-tile')).not.toHaveClass('place-tile-muted');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('highlights the first place, and Enter chooses it', async () => {
    vi.stubGlobal('fetch', answer(PARADEPLATZ));
    const { input, onSelect } = renderSearch();
    await type(input, 'Paradeplatz');

    const options = screen.getAllByRole('option');
    expect(options.map(option => option.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(PARADEPLATZ[0]);
  });

  it('moves the highlight with the arrow keys, around both ends, and chooses with a tap as well', async () => {
    vi.stubGlobal('fetch', answer(PARADEPLATZ));
    const { input, onSelect } = renderSearch();
    await type(input, 'Paradeplatz');
    const selected = () => screen.getAllByRole('option').findIndex(option => option.getAttribute('aria-selected') === 'true');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(selected()).toBe(2);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selected()).toBe(0);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(selected()).toBe(1);
    expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(PARADEPLATZ[1]);

    fireEvent.click(screen.getAllByRole('option')[2]);
    expect(onSelect).toHaveBeenLastCalledWith(PARADEPLATZ[2]);
  });

  it('splits the label itself and works out the coverage when the answer has neither', async () => {
    vi.stubGlobal('fetch', answer([
      { lat: 47.378, lng: 8.54, display_name: 'Zürich HB, Switzerland' },
      { lat: 46.7741, lng: 8.1558, display_name: 'Lungern, OW' },
    ]));
    const { input, onSelect } = renderSearch();
    await type(input, 'Zürich HB');

    const options = screen.getAllByRole('option');
    expect(options.map(option => option.getAttribute('aria-label'))).toEqual(['Zürich HB, Switzerland', 'Lungern, OW, No data']);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      lat: 47.378, lng: 8.54, display_name: 'Zürich HB, Switzerland', title: 'Zürich HB', subtitle: 'Switzerland', covered: true,
    });
  });

  it('empties the field with the clear button and brings the suggestions back', async () => {
    vi.stubGlobal('fetch', answer(PARADEPLATZ));
    const { input, onSelect, onCancel } = renderSearch({ recentPlaces: [lille] });
    await type(input, 'Paradeplatz');
    expect(screen.getAllByRole('option')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByRole('group', { name: 'Recent' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    // Only the text goes: the search stays open and no place is chosen or dropped.
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('when there is nothing to list', () => {
  it('says that no place was found and how to search abroad', async () => {
    vi.stubGlobal('fetch', answer([]));
    const { input, onSelect } = renderSearch();
    await type(input, 'Xyzzy');

    expect(screen.getByRole('status')).toHaveTextContent(/^No places found\. Outside Switzerland, search by city\.$/);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    // Enter has nothing to choose.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('says that the search is not available and searches again at once with Try again', async () => {
    const fetcher = vi.fn()
      .mockImplementationOnce(async () => new Response('{}', { status: 502 }))
      .mockImplementation(async () => Response.json(PARADEPLATZ));
    vi.stubGlobal('fetch', fetcher);
    const { input } = renderSearch();
    await type(input, 'Paradeplatz');

    expect(screen.getByRole('status')).toHaveTextContent(/^Search isn’t available right now\.$/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    // No pause before the second attempt, and the keyboard stays with the field.
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith('/api/geocode', expect.objectContaining({
      body: JSON.stringify({ q: 'Paradeplatz', lang: 'en' }),
    }));
    expect(input).toHaveFocus();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('gives up on a search that stalls, and searches again when the text changes', async () => {
    const fetcher = vi.fn().mockImplementationOnce((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    })).mockImplementation(async () => Response.json([{ lat: 47.378, lng: 8.54, display_name: 'Zurich' }]));
    vi.stubGlobal('fetch', fetcher);
    const { input } = renderSearch();

    fireEvent.change(input, { target: { value: 'Zur' } });
    await act(async () => vi.advanceTimersByTimeAsync(12_349));
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByRole('status')).toHaveTextContent('Search isn’t available right now.');

    await type(input, 'Zurich');
    expect(screen.getByRole('option', { name: 'Zurich' })).toBeVisible();
  });

  it('ignores the answer to a text that has since changed', async () => {
    let release: (response: Response) => void = () => {};
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }))
      .mockImplementation(async () => Response.json([PARADEPLATZ[1]]));
    vi.stubGlobal('fetch', fetcher);
    const { input } = renderSearch();
    await type(input, 'Parade');
    await type(input, 'Paradeplatz 2');
    expect(screen.getAllByRole('option')).toHaveLength(1);

    // The first answer arrives late: it must not replace what the field now asks for.
    await act(async () => { release(Response.json(PARADEPLATZ)); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getAllByRole('option').map(option => option.getAttribute('aria-label'))).toEqual(['Paradeplatz 2, 8001 Zürich']);
  });
});
