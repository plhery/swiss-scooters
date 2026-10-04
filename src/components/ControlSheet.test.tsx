// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ControlSheet from '@/components/ControlSheet';
import { I18nProvider } from '@/lib/i18n';
import { PROVIDER_KEYS } from '@/lib/types';

type Props = React.ComponentProps<typeof ControlSheet>;

function sheetProps(overrides: Partial<Props> = {}): Props {
  return {
    open: true,
    panel: 'filters',
    minBattery: 0,
    enabledProviders: new Set(PROVIDER_KEYS),
    availableProviders: ['lime', 'bird', 'dott', 'bolt'],
    providerCounts: { bolt: 4, dott: 2, lime: 1200 },
    downProviders: [],
    hasActiveFilters: false,
    showCount: 14,
    theme: 'auto',
    mapStyle: 'calm',
    onClose: vi.fn(),
    onMinBatteryChange: vi.fn(),
    onProviderToggle: vi.fn(),
    onResetFilters: vi.fn(),
    onThemeChange: vi.fn(),
    onMapStyleChange: vi.fn(),
    ...overrides,
  };
}

function renderSheet(overrides: Partial<Props> = {}) {
  const props = sheetProps(overrides);
  const view = render(<I18nProvider><ControlSheet {...props} /></I18nProvider>);
  const rerender = (next: Partial<Props>) =>
    view.rerender(<I18nProvider><ControlSheet {...props} {...next} /></I18nProvider>);
  return { ...view, props, rerender };
}

const providerRows = () =>
  within(screen.getByRole('group', { name: 'Providers' })).getAllByRole('button');
// The thousands separator of Swiss numbers depends on the runtime's locale data.
const grouped = (value: number) => new Intl.NumberFormat('en-CH').format(value);

beforeEach(() => {
  localStorage.setItem('scooters-locale', 'en');
  // jsdom has neither modal dialogs nor animations.
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('prefers-reduced-motion') }));
});

afterEach(() => vi.unstubAllGlobals());

describe('ControlSheet filters', () => {
  it('is a dialog named Filters that opens and closes with the page', () => {
    const { rerender, container } = renderSheet({ open: false });
    const dialog = container.querySelector('dialog')!;
    expect(dialog.open).toBe(false);

    rerender({ open: true });
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBe(dialog);
    expect(dialog.open).toBe(true);

    rerender({ open: false });
    expect(dialog.open).toBe(false);
  });

  it('offers the battery minimum as one choice of four, without a slider', () => {
    const { props, rerender } = renderSheet();
    const battery = screen.getByRole('group', { name: 'Battery' });
    const presets = within(battery).getAllByRole('button');
    expect(presets.map(preset => preset.textContent)).toEqual(['Any', '30%+', '60%+', '80%+']);
    expect(presets.map(preset => preset.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
    expect(screen.queryByRole('slider')).toBeNull();
    // Nothing is hidden while any battery level will do.
    expect(screen.queryByText('Scooters without battery info are hidden while a minimum is set.')).toBeNull();

    fireEvent.click(within(battery).getByRole('button', { name: '60%+' }));
    expect(props.onMinBatteryChange).toHaveBeenCalledExactlyOnceWith(60);
    // The choice already made is not made again.
    fireEvent.click(within(battery).getByRole('button', { name: 'Any' }));
    expect(props.onMinBatteryChange).toHaveBeenCalledOnce();

    rerender({ minBattery: 60 });
    expect(within(battery).getByRole('button', { name: '60%+' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(battery).getByRole('button', { name: 'Any' })).toHaveAttribute('aria-pressed', 'false');
    expect(battery).toHaveAccessibleDescription('Scooters without battery info are hidden while a minimum is set.');
  });

  it('shows a minimum from the slider era as the preset below it', () => {
    renderSheet({ minBattery: 45 });
    expect(screen.getByRole('button', { name: '30%+' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lists the providers of this part of the map in catalogue order with their counts', () => {
    const { props } = renderSheet({ enabledProviders: new Set(['bolt', 'bird', 'lime']) });
    const rows = providerRows();
    expect(rows.map(row => row.getAttribute('aria-label'))).toEqual([
      'Bolt, 4. Shown.',
      'Bird, 0. Shown.',
      'Dott, 2. Hidden.',
      `Lime, ${grouped(1200)}. Shown.`,
    ]);
    expect(rows.map(row => row.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'false', 'true']);
    expect(rows.map(row => row.querySelector('.provider-count')?.textContent)).toEqual(['4', '0', '2', grouped(1200)]);
    // A check for a provider that is shown, an empty circle for one that is hidden.
    expect(rows.map(row => row.querySelector('.provider-check svg') !== null)).toEqual([true, true, false, true]);

    fireEvent.click(rows[2]);
    expect(props.onProviderToggle).toHaveBeenCalledExactlyOnceWith('dott');
  });

  it('says that a provider is not sharing data instead of counting it, and keeps it a choice', () => {
    const { props } = renderSheet({ downProviders: ['bird'] });
    const [bolt, bird, dott, lime] = providerRows();
    expect(bird).toHaveAccessibleName('Bird: not sharing data right now');
    expect(bird).toHaveTextContent('Not sharing data right now');
    expect(bird.querySelector('.provider-count')).toBeNull();
    // Chosen, but nothing to promise: the circle is dashed and has no check.
    expect(bird).toHaveClass('provider-down');
    expect(bird).toHaveAttribute('aria-pressed', 'true');
    expect(bird.querySelector('.provider-check svg')).toBeNull();
    // The others are counted as before.
    for (const row of [bolt, dott, lime]) expect(row).not.toHaveClass('provider-down');
    expect(lime).toHaveAccessibleName(`Lime, ${grouped(1200)}. Shown.`);

    fireEvent.click(bird);
    expect(props.onProviderToggle).toHaveBeenCalledExactlyOnceWith('bird');
  });

  it('says so where no provider operates', () => {
    renderSheet({ availableProviders: [], providerCounts: {}, showCount: 0 });
    const group = screen.getByRole('group', { name: 'Providers' });
    expect(within(group).queryAllByRole('button')).toHaveLength(0);
    expect(group).toHaveTextContent('No scooter data here yet');
  });

  it('resets only when a filter is active', () => {
    const { props, rerender } = renderSheet();
    const reset = screen.getByRole('button', { name: 'Reset' });
    expect(reset).toBeDisabled();
    fireEvent.click(reset);
    expect(props.onResetFilters).not.toHaveBeenCalled();

    rerender({ hasActiveFilters: true });
    expect(reset).toBeEnabled();
    fireEvent.click(reset);
    expect(props.onResetFilters).toHaveBeenCalledOnce();
  });

  it('ends with a button that says what the map will show and closes the sheet', () => {
    const { props, rerender } = renderSheet();
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(within(dialog).queryByRole('button', { name: 'Done' })).toBeNull();
    const show = within(dialog).getByRole('button', { name: 'Show 14 scooters' });

    rerender({ showCount: 1 });
    expect(show).toHaveTextContent('Show 1 scooter');
    rerender({ showCount: 0 });
    expect(show).toHaveTextContent('Show 0 scooters');
    rerender({ showCount: 2000 });
    expect(show).toHaveTextContent(`Show ${grouped(2000)} scooters`);
    // The answer for a new minimum is on its way: there is no count to promise.
    rerender({ showCount: null });
    expect(show).toHaveTextContent('Finding scooters…');

    fireEvent.click(show);
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('closes with Escape', () => {
    const { props } = renderSheet();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});

describe('ControlSheet settings', () => {
  const settings = (overrides: Partial<Props> = {}) => renderSheet({ panel: 'settings', ...overrides });
  const pressed = (group: HTMLElement) =>
    within(group).getAllByRole('button').map(button => `${button.textContent}:${button.getAttribute('aria-pressed')}`);

  it('is a dialog named Settings with appearance, map, language and About, in that order', () => {
    settings();
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(['Appearance', 'Map', 'Language', 'About']);
    // The sources live in the credits; nothing is left of the English-only footer.
    expect(within(dialog).queryByRole('link', { name: 'MobiData BW' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Reset' })).toBeNull();
  });

  it('offers the appearance as Automatic, Light or Dark', () => {
    const { props, rerender } = settings();
    const appearance = screen.getByRole('group', { name: 'Appearance' });
    expect(pressed(appearance)).toEqual(['Automatic:true', 'Light:false', 'Dark:false']);

    fireEvent.click(within(appearance).getByRole('button', { name: 'Dark' }));
    expect(props.onThemeChange).toHaveBeenCalledExactlyOnceWith('dark');
    // The appearance already chosen is not chosen again.
    fireEvent.click(within(appearance).getByRole('button', { name: 'Automatic' }));
    expect(props.onThemeChange).toHaveBeenCalledOnce();

    rerender({ panel: 'settings', theme: 'dark' });
    expect(pressed(appearance)).toEqual(['Automatic:false', 'Light:false', 'Dark:true']);
  });

  it('offers the map as Calm or Detailed, each with a picture', () => {
    const { props, rerender } = settings();
    const map = screen.getByRole('group', { name: 'Map' });
    expect(pressed(map)).toEqual(['Calm:true', 'Detailed:false']);
    expect(map.querySelector('.map-style-calm')).not.toBeNull();
    expect(map.querySelector('.map-style-detailed')).not.toBeNull();

    fireEvent.click(within(map).getByRole('button', { name: 'Detailed' }));
    expect(props.onMapStyleChange).toHaveBeenCalledExactlyOnceWith('detailed');
    fireEvent.click(within(map).getByRole('button', { name: 'Calm' }));
    expect(props.onMapStyleChange).toHaveBeenCalledOnce();

    rerender({ panel: 'settings', mapStyle: 'detailed' });
    expect(pressed(map)).toEqual(['Calm:false', 'Detailed:true']);
  });

  it('names the languages in their own language and switches at once', () => {
    settings();
    const language = screen.getByRole('group', { name: 'Language' });
    expect(pressed(language)).toEqual(['Deutsch:false', 'Français:false', 'Italiano:false', 'English:true']);
    expect(within(language).getAllByRole('button').map(button => button.lang))
      .toEqual(['de-CH', 'fr-CH', 'it-CH', 'en-CH']);

    fireEvent.click(within(language).getByRole('button', { name: 'Deutsch' }));
    expect(screen.getByRole('dialog', { name: 'Einstellungen' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Darstellung' })).toBeInTheDocument();
    expect(pressed(screen.getByRole('group', { name: 'Sprache' })))
      .toEqual(['Deutsch:true', 'Français:false', 'Italiano:false', 'English:false']);
    expect(localStorage.getItem('scooters-locale')).toBe('de');
  });

  it('leads from About to the privacy notice and to the source code', () => {
    settings();
    expect(screen.getByRole('link', { name: 'Privacy notice' })).toHaveAttribute('href', '/privacy');
    const source = screen.getByRole('link', { name: 'Source code on GitHub' });
    expect(source).toHaveAttribute('href', 'https://github.com/plhery/swiss-scooters');
    expect(source).toHaveAttribute('target', '_blank');
    expect(source).toHaveAttribute('rel', 'noreferrer');
  });

  it('opens the credits list from About, and leads back to where it was opened', () => {
    const { rerender } = settings();
    fireEvent.click(screen.getByRole('button', { name: 'Map & data credits' }));
    const credits = screen.getByRole('dialog', { name: 'Map & data credits' });
    // The view starts at its heading; the settings themselves are out of the way.
    expect(within(credits).getByRole('heading', { name: 'Map & data credits', level: 2 })).toHaveFocus();
    expect(within(credits).queryByRole('group', { name: 'Appearance' })).toBeNull();
    const links = within(credits).getAllByRole('link');
    expect(links.map(link => link.textContent)).toEqual([
      '© OpenStreetMap contributors',
      'Mobility data CH',
      'France: Dott, Bird, Lime, Voi, Pony',
      'MobiData BW',
      'DE/IT: Dott, Bolt, Hopp, Lime, Voi, Bird',
      '© swisstopo',
      'Parking · Métropole Européenne de Lille',
    ]);
    // Sources open beside the map instead of taking its place.
    expect(links.every(link => link.getAttribute('target') === '_blank' && link.getAttribute('rel') === 'noreferrer')).toBe(true);
    expect(within(credits).getByRole('button', { name: 'Done' })).toBeInTheDocument();

    fireEvent.click(within(credits).getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Map & data credits' })).toHaveFocus();

    // Closed on the credits, the settings open on their first view again.
    fireEvent.click(screen.getByRole('button', { name: 'Map & data credits' }));
    rerender({ panel: 'settings', open: false });
    rerender({ panel: 'settings', open: true });
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Appearance' })).toBeInTheDocument();
  });

  it('closes with Done', () => {
    const { props } = settings();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
