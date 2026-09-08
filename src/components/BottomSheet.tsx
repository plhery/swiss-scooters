'use client';

import { track } from '@/lib/analytics';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { PROVIDERS, type Vehicle } from '@/lib/types';
import { useI18n } from '@/lib/i18n';
import { browserRentalLink } from '@/lib/rentalLinks';
import { selectionFeedback } from '@/lib/feedback';
import Icon from './Icon';

export interface SelectedVehicle {
  vehicle: Vehicle;
  distanceM: number | null;
}

interface BottomSheetProps {
  minBattery: number;
  enabledProviders: Set<string>;
  providerCounts: Record<string, number>;
  availableProviders: string[];
  totalCount: number;
  loading: boolean;
  lastUpdated: Date | null;
  dataHealthNotice: string | null;
  selectedVehicle: SelectedVehicle | null;
  hidden: boolean;
  onShowAllProviders: () => void;
  onProviderToggle: (provider: string) => void;
  onClearSelection: () => void;
  onResetFilters: () => void;
}

export default function BottomSheet({
  minBattery,
  enabledProviders,
  providerCounts,
  availableProviders,
  totalCount,
  loading,
  lastUpdated,
  dataHealthNotice,
  selectedVehicle,
  hidden,
  onShowAllProviders,
  onProviderToggle,
  onClearSelection,
  onResetFilters,
}: BottomSheetProps) {
  const { locale, t, formatNumber } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const providerKeys = availableProviders.filter((key) => PROVIDERS[key]);
  const allProvidersSelected = providerKeys.every((provider) => enabledProviders.has(provider));
  const allProviderCount = providerKeys.reduce(
    (count, provider) => count + (providerCounts[provider] ?? 0),
    0
  );
  const hasActiveFilters = minBattery > 0 || !allProvidersSelected;

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const sheet = sheetRef.current;
    if (!content || !sheet) return;
    // Measure natural content once per resize. CSS animates the dock height;
    // neither dragging the map nor animation frames trigger React renders.
    const update = () => {
      const height = Math.ceil(content.getBoundingClientRect().height);
      sheet.style.height = `${height}px`;
      document.documentElement.style.setProperty('--sheet-peek-h', `${height}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(content);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--sheet-peek-h');
    };
  }, []);

  const age = lastUpdated ? Math.max(0, now - lastUpdated.getTime()) : null;
  const updatedLabel = loading
    ? t('sheet.updating')
    : lastUpdated && age !== null
      ? age < 60_000
        ? t('sheet.justNow')
        : age < 3_600_000
          ? t('sheet.minutesAgo', { count: Math.max(1, Math.floor(age / 60_000)) })
          : t('sheet.updated', {
              time: lastUpdated.toLocaleTimeString(`${locale}-CH`, {
                hour: '2-digit',
                minute: '2-digit',
              }),
            })
      : t('sheet.onMap');
  const fresh = !loading && !dataHealthNotice && age !== null && age < 90_000;
  const distance = (meters: number) =>
    meters < 1000
      ? t('distance.meters', { count: formatNumber(Math.round(meters)) })
      : t('distance.kilometers', {
          count: formatNumber(meters / 1000, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
        });

  const vehicle = selectedVehicle?.vehicle;
  const provider = vehicle ? PROVIDERS[vehicle.provider] : null;
  const rentalLink = vehicle
    ? browserRentalLink(
        vehicle,
        typeof navigator === 'undefined' ? '' : navigator.userAgent,
        typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints
      )
    : null;

  return (
    <div
      ref={sheetRef}
      className="sheet glass"
      role="region"
      aria-label={t('sheet.region')}
      inert={hidden}
      aria-hidden={hidden}
    >
      <div ref={contentRef} className="sheet-content">
        <div className="sheet-title-row">
          <div className="dock-summary">
            <div className="sheet-count" aria-live="polite" aria-atomic="true">
              {loading && lastUpdated === null ? (
                t('sheet.finding')
              ) : (
                <>
                  <span key={totalCount} className="sheet-count-num">
                    {formatNumber(totalCount)}
                  </span>
                  {t(totalCount === 1 ? 'sheet.scooterOnMap' : 'sheet.scootersOnMap')}
                </>
              )}
            </div>
            <div className="sheet-sub">
              {loading ? (
                <span className="mini-spinner" aria-hidden="true" />
              ) : (
                fresh && <span className="freshness-dot" aria-hidden="true" />
              )}
              <span>
                {hasActiveFilters ? `${t('filters.active')} · ${updatedLabel}` : updatedLabel}
              </span>
            </div>
            {dataHealthNotice && (
              <div className="sheet-health" role="status">
                <span aria-hidden="true">!</span>
                {dataHealthNotice}
              </div>
            )}
          </div>
          {vehicle && (
            <button
              type="button"
              className="vehicle-card-close"
              onClick={() => {
                selectionFeedback();
                onClearSelection();
              }}
              aria-label={t('marker.close')}
            >
              <Icon name="close" size={17} />
            </button>
          )}
        </div>

        <div className="chips" role="group" aria-label={t('providers.filter')}>
          <button
            type="button"
            className={`chip ${allProvidersSelected ? 'chip-selected' : ''}`}
            onClick={() => {
              if (!allProvidersSelected) selectionFeedback();
              onShowAllProviders();
            }}
            aria-pressed={allProvidersSelected}
            aria-label={t('providers.allLabel', { count: formatNumber(allProviderCount) })}
          >
            <Icon name="grid" size={14} />
            {t('providers.all')}
            <span className="chip-count">{formatNumber(allProviderCount)}</span>
          </button>
          {providerKeys.map((key) => {
            const shown = enabledProviders.has(key);
            return (
              <button
                type="button"
                key={key}
                className={`chip ${shown && !allProvidersSelected ? 'chip-selected' : ''}`}
                onClick={() => {
                  selectionFeedback();
                  onProviderToggle(key);
                }}
                aria-pressed={shown}
                aria-label={t('providers.toggleLabel', {
                  name: PROVIDERS[key].name,
                  count: formatNumber(providerCounts[key] ?? 0),
                  state: t(shown ? 'providers.selected' : 'providers.notSelected'),
                })}
              >
                <span
                  className="chip-dot"
                  style={{ background: PROVIDERS[key].color }}
                  aria-hidden="true"
                />
                {PROVIDERS[key].name}
                <span className="chip-count">{formatNumber(providerCounts[key] ?? 0)}</span>
              </button>
            );
          })}
        </div>

        {vehicle && selectedVehicle ? (
          <div
            key={`${vehicle.provider}:${vehicle.vehicle_id ?? `${vehicle.lat}:${vehicle.lng}`}`}
            className="vehicle-card"
          >
            <div className="vehicle-card-head">
              {selectedVehicle.distanceM !== null && (
                <div className="walking-summary">
                  <strong>
                    ≈{formatNumber(Math.max(1, Math.ceil(selectedVehicle.distanceM / 80)))}
                    <small> min</small>
                  </strong>
                  <span>{t('marker.walk')}</span>
                  <span className="walking-distance">{distance(selectedVehicle.distanceM)}</span>
                </div>
              )}
              <div className="vehicle-card-copy">
                <strong>
                  <span className="chip-dot" style={{ background: provider?.color ?? '#8e8e93' }} />
                  {provider?.name ?? vehicle.provider}
                </strong>
                <div className="vehicle-stats">
                  {vehicle.battery !== null && (
                    <span
                      style={{
                        color: vehicle.battery <= 20 ? 'var(--warning-ink)' : 'var(--success-ink)',
                      }}
                    >
                      <Icon name="battery" size={17} />
                      {formatNumber(vehicle.battery)}%
                    </span>
                  )}
                  {vehicle.range_m !== null && (
                    <span>
                      <Icon name="range" size={16} />
                      {distance(vehicle.range_m)}
                    </span>
                  )}
                </div>
              </div>
              <span
                className="vehicle-symbol"
                style={{ '--provider-color': provider?.color ?? '#8e8e93' } as CSSProperties}
              >
                <Icon name="scooter" size={27} />
              </span>
            </div>
            <div className="vehicle-actions">
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${vehicle.lat},${vehicle.lng}`)}&travelmode=walking`}
                target="_blank"
                rel="noreferrer"
                onClick={() => { track('directions_open', { provider: vehicle.provider, target: 'vehicle' }); selectionFeedback(); }}
              >
                <Icon name="walk" size={18} />
                {t('marker.walkThere')}
              </a>
              {rentalLink && (
                <a
                  className="vehicle-action-primary"
                  href={rentalLink}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => { track('rental_open', { provider: vehicle.provider }); selectionFeedback(); }}
                >
                  <Icon name="scooter" size={18} />
                  {t('marker.openIn', { name: provider?.name ?? t('marker.app') })}
                </a>
              )}
            </div>
          </div>
        ) : (
          !loading &&
          totalCount === 0 && (
            <div className="empty-hint" role="status">
              <Icon name="pin" size={17} />
              <span>{t(hasActiveFilters ? 'empty.filtered' : 'empty.area')}</span>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={() => {
                    selectionFeedback();
                    onResetFilters();
                  }}
                >
                  {t('filters.reset')}
                </button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
