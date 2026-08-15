'use client';

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { PROVIDERS, type Vehicle } from '@/lib/types';
import { SUPPORTED_LOCALES, useI18n, type AppLocale } from '@/lib/i18n';
import AddressSearch, { type AddressResult } from '@/components/AddressSearch';

export interface SelectedVehicle {
  vehicle: Vehicle;
  distanceM: number | null;
}

interface BottomSheetProps {
  minBattery: number;
  enabledProviders: Set<string>;
  providerCounts: Record<string, number>;
  totalCount: number;
  loading: boolean;
  lastUpdated: Date | null;
  dataHealthNotice: string | null;
  tileLayer: 'dark' | 'light' | 'osm';
  selectedVehicle: SelectedVehicle | null;
  onMinBatteryChange: (battery: number) => void;
  onAddressSelect: (result: AddressResult) => void;
  onAddressClear: () => void;
  onShowAllProviders: () => void;
  onProviderToggle: (provider: string) => void;
  onTileLayerChange: (tile: 'dark' | 'light' | 'osm') => void;
  onExpandedChange: (expanded: boolean) => void;
  onClearSelection: () => void;
  onResetFilters: () => void;
}

const DESKTOP_PANEL_QUERY = '(min-width: 900px)';
const LOCALE_LABELS: Record<AppLocale, string> = {
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  en: 'English',
};

function subscribeToDesktopPanel(change: () => void) {
  const query = window.matchMedia(DESKTOP_PANEL_QUERY);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

function useDesktopPanel() {
  return useSyncExternalStore(
    subscribeToDesktopPanel,
    () => window.matchMedia(DESKTOP_PANEL_QUERY).matches,
    () => false
  );
}

function SliderRow({
  label, value, display, min, max, step, onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider-row">
      <div className="slider-head">
        <span>{label}</span>
        <span className="slider-val">{display}</span>
      </div>
      <input
        type="range"
        className="ios-slider"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={event => onChange(parseInt(event.target.value))}
        style={{ '--fill': `${pct}%` } as React.CSSProperties}
        aria-label={`${label}: ${display}`}
      />
    </div>
  );
}

export default function BottomSheet({
  minBattery,
  enabledProviders,
  providerCounts,
  totalCount,
  loading,
  lastUpdated,
  dataHealthNotice,
  tileLayer,
  selectedVehicle,
  onMinBatteryChange,
  onAddressSelect,
  onAddressClear,
  onShowAllProviders,
  onProviderToggle,
  onTileLayerChange,
  onExpandedChange,
  onClearSelection,
  onResetFilters,
}: BottomSheetProps) {
  const { locale, setLocale, t, formatNumber } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [peekH, setPeekH] = useState(160);
  const desktopPanel = useDesktopPanel();
  const controlsVisible = desktopPanel || expanded;
  const providerKeys = Object.keys(PROVIDERS);
  const allProvidersSelected = providerKeys.every(provider => enabledProviders.has(provider));
  const allProviderCount = providerKeys.reduce(
    (count, provider) => count + (providerCounts[provider] ?? 0),
    0
  );
  const hasActiveFilters = minBattery > 0 || !allProvidersSelected;

  const sheetRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startY: number;
    base: number;
    max: number;
    moved: boolean;
    lastY: number;
    lastT: number;
    vel: number;
  } | null>(null);

  useLayoutEffect(() => {
    const element = peekRef.current;
    if (!element) return;
    const update = () => {
      const height = element.offsetHeight;
      setPeekH(height);
      document.documentElement.style.setProperty('--sheet-peek-h', `${height}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--sheet-peek-h');
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent) => {
    if (desktopPanel) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const max = Math.max(sheet.offsetHeight - peekH, 0);
    dragRef.current = {
      startY: event.clientY,
      base: expanded ? 0 : max,
      max,
      moved: false,
      lastY: event.clientY,
      lastT: performance.now(),
      vel: 0,
    };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    sheet.style.transition = 'none';
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (desktopPanel) return;
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet) return;
    const delta = event.clientY - drag.startY;
    if (Math.abs(delta) > 4) drag.moved = true;
    const now = performance.now();
    const elapsed = now - drag.lastT;
    if (elapsed > 0) drag.vel = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastT = now;
    const offset = Math.min(Math.max(drag.base + delta, 0), drag.max);
    sheet.style.transform = `translate3d(0, ${offset}px, 0)`;
  };

  const handlePointerEnd = (event: React.PointerEvent) => {
    if (desktopPanel) return;
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet) return;
    dragRef.current = null;

    const offset = Math.min(
      Math.max(drag.base + (event.clientY - drag.startY), 0),
      drag.max
    );
    const next = !drag.moved
      ? !expanded
      : Math.abs(drag.vel) > 0.4
        ? drag.vel < 0
        : offset < drag.max / 2;
    flushSync(() => {
      setExpanded(next);
      onExpandedChange(next);
    });
    sheet.style.transition = '';
    sheet.style.transform = '';
  };

  const updatedLabel = loading
    ? t('sheet.updating')
    : lastUpdated
      ? t('sheet.updated', {
          time: lastUpdated.toLocaleTimeString(`${locale}-CH`, {
            hour: '2-digit',
            minute: '2-digit',
          }),
        })
      : t('sheet.onMap');

  const formatDistance = (meters: number | null) => {
    if (meters === null) return null;
    return meters < 1000
      ? t('distance.meters', { count: formatNumber(Math.round(meters)) })
      : t('distance.kilometers', {
          count: formatNumber(meters / 1000, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
        });
  };

  const selectedVehicleDetails = ({ vehicle, distanceM }: SelectedVehicle) => {
    const provider = PROVIDERS[vehicle.provider];
    const destination = `${vehicle.lat},${vehicle.lng}`;
    const range = vehicle.range_m === null ? null : formatDistance(vehicle.range_m);
    const distance = formatDistance(distanceM);
    return (
      <div className="vehicle-card vehicle-card-selected">
        <div className="vehicle-card-head">
          <span
            className="vehicle-provider-dot"
            style={{ background: provider?.color ?? '#8e8e93' }}
            aria-hidden="true"
          />
          <div className="vehicle-card-copy">
            <strong>{provider?.name ?? vehicle.provider}</strong>
            <span>
              {[distance, vehicle.battery === null ? null : `${formatNumber(vehicle.battery)}%`, range]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          <button
            type="button"
            className="vehicle-card-close"
            onClick={onClearSelection}
            aria-label={t('marker.close')}
          >
            ×
          </button>
        </div>
        <div className="vehicle-actions">
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=walking`}
            target="_blank"
            rel="noreferrer"
          >
            {t('marker.walkThere')}
          </a>
          {vehicle.deep_link && (
            <a
              className="vehicle-action-primary"
              style={{ background: provider?.color ?? 'var(--blue)' }}
              href={vehicle.deep_link}
              target="_blank"
              rel="noreferrer"
            >
              {t('marker.openIn', { name: provider?.name ?? t('marker.app') })}
            </a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={sheetRef}
      className={`sheet glass ${controlsVisible ? 'sheet-expanded' : ''} ${desktopPanel ? 'sheet-desktop' : ''}`}
      style={{ '--peek-h': `${peekH}px` } as React.CSSProperties}
      role="region"
      aria-label={t('sheet.region')}
    >
      <div ref={peekRef} className="sheet-peek">
        <div
          className="sheet-handle"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          role={desktopPanel ? undefined : 'button'}
          tabIndex={desktopPanel ? undefined : 0}
          aria-expanded={desktopPanel ? undefined : expanded}
          aria-controls={desktopPanel ? undefined : 'scooter-controls-body'}
          aria-label={desktopPanel ? undefined : expanded ? t('sheet.collapse') : t('sheet.expand')}
          onKeyDown={desktopPanel ? undefined : event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              const next = !expanded;
              setExpanded(next);
              onExpandedChange(next);
            }
          }}
        >
          <div className="grabber" aria-hidden="true" />
          <div className="sheet-title-row">
            <div>
              {loading && lastUpdated === null ? (
                <div className="sheet-count sheet-finding">
                  <span className="mini-spinner" aria-hidden="true" />
                  {t('sheet.finding')}
                </div>
              ) : (
                <div className="sheet-count" aria-live="polite">
                  <span className="sheet-count-num">{formatNumber(totalCount)}</span>
                  {totalCount === 1 ? t('sheet.scooter') : t('sheet.scooters')}
                </div>
              )}
              <div className="sheet-sub">
                {hasActiveFilters ? `${t('filters.active')} · ${updatedLabel}` : updatedLabel}
              </div>
              {dataHealthNotice && (
                <div className="sheet-health" role="status">
                  <span aria-hidden="true">!</span>
                  {dataHealthNotice}
                </div>
              )}
            </div>
            <div className="sheet-chevron" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 15 6-6 6 6" />
              </svg>
            </div>
          </div>
        </div>

        {selectedVehicle ? (
          <div className="selected-vehicle-wrap">{selectedVehicleDetails(selectedVehicle)}</div>
        ) : (
          <div className="chips" role="group" aria-label={t('providers.filter')}>
            <button
              className={`chip ${allProvidersSelected ? '' : 'chip-off'}`}
              style={allProvidersSelected ? { background: 'rgba(10, 132, 255, 0.12)' } : undefined}
              onClick={onShowAllProviders}
              aria-pressed={allProvidersSelected}
              aria-label={t('providers.allLabel', { count: formatNumber(allProviderCount) })}
              title={t('providers.showAll')}
            >
              <span className="chip-dot chip-dot-all" aria-hidden="true" />
              {t('providers.all')}
              <span className="chip-count">{formatNumber(allProviderCount)}</span>
            </button>
            {Object.entries(PROVIDERS).map(([key, provider]) => {
              const selected = enabledProviders.has(key);
              return (
                <button
                  key={key}
                  className={`chip ${selected ? '' : 'chip-off'}`}
                  style={selected && !allProvidersSelected ? { background: `${provider.color}1f` } : undefined}
                  onClick={() => onProviderToggle(key)}
                  aria-pressed={selected}
                  aria-label={t('providers.toggleLabel', {
                    name: provider.name,
                    count: formatNumber(providerCounts[key] ?? 0),
                    state: t(selected ? 'providers.selected' : 'providers.notSelected'),
                  })}
                >
                  <span className="chip-dot" style={{ background: provider.color }} aria-hidden="true" />
                  {provider.name}
                  <span className="chip-count">{formatNumber(providerCounts[key] ?? 0)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div id="scooter-controls-body" className="sheet-body" inert={!controlsVisible}>
        <AddressSearch onSelect={onAddressSelect} onClear={onAddressClear} />

        <section className="section">
          <div className="section-heading">
            <div className="section-title">{t('filters.title')}</div>
            {hasActiveFilters && (
              <button type="button" className="reset-link" onClick={onResetFilters}>
                {t('filters.reset')}
              </button>
            )}
          </div>
          <SliderRow
            label={t('filters.minBattery')}
            value={minBattery}
            display={minBattery === 0 ? t('filters.any') : `${formatNumber(minBattery)}%`}
            min={0}
            max={100}
            step={5}
            onChange={onMinBatteryChange}
          />
          {minBattery > 0 && <p className="filter-help">{t('filters.unknownBattery')}</p>}
        </section>

        <details className="settings-disclosure section">
          <summary>{t('settings.title')}</summary>
          <div className="settings-body">
            <div>
              <div className="section-title">{t('map.style')}</div>
              <div className="seg" role="group" aria-label={t('map.style')}>
                {(['light', 'dark', 'osm'] as const).map(style => (
                  <button
                    key={style}
                    onClick={() => onTileLayerChange(style)}
                    aria-pressed={tileLayer === style}
                  >
                    {style === 'light' ? t('map.light') : style === 'dark' ? t('map.dark') : t('map.osm')}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="section-title">{t('language.title')}</div>
              <div className="seg" role="group" aria-label={t('language.title')}>
                {SUPPORTED_LOCALES.map(language => (
                  <button
                    key={language}
                    onClick={() => setLocale(language)}
                    aria-pressed={locale === language}
                    lang={`${language}-CH`}
                    title={LOCALE_LABELS[language]}
                  >
                    {language.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="sheet-footer">
              <a href="/privacy">{t('links.privacy')}</a>
              <span aria-hidden="true">·</span>
              <a href="https://opentransportdata.swiss/en/cookbook/shared-mobility/" target="_blank" rel="noreferrer">
                Mobility data
              </a>
              <span aria-hidden="true">·</span>
              <a href="https://www.geo.admin.ch/en/geo-services/geo-services/application-programming-interface-api" target="_blank" rel="noreferrer">
                Address data © swisstopo
              </a>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
