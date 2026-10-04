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
    tileLayer: 'light',
    onClose: vi.fn(),
    onMinBatteryChange: vi.fn(),
    onProviderToggle: vi.fn(),
    onResetFilters: vi.fn(),
    onTileLayerChange: vi.fn(),
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
    const { props } = renderSheet({ downProviders: ['bird', 'lime'] });
    const [, bird, , lime] = providerRows();
    expect(bird).toHaveAccessibleName('Bird: not sharing data right now');
    expect(bird).toHaveTextContent('Not sharing data right now');
    expect(bird.querySelector('.provider-count')).toBeNull();
    // Chosen, but nothing to promise: the circle is dashed and has no check.
    expect(bird).toHaveClass('provider-down');
    expect(bird).toHaveAttribute('aria-pressed', 'true');
    expect(bird.querySelector('.provider-check svg')).toBeNull();
    // A provider with scooters in view is counted, whatever one of its feeds did.
    expect(lime).toHaveAccessibleName(`Lime, ${grouped(1200)}. Shown.`);
    expect(lime).not.toHaveClass('provider-down');

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
