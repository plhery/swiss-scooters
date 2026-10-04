'use client';

import { track } from '@/lib/analytics';

import { useId, type CSSProperties } from 'react';
import { BATTERY_PRESETS, batteryPresetLabel, snapBatteryPreset } from '@/lib/battery';
import { SUPPORTED_LOCALES, useI18n, type AppLocale } from '@/lib/i18n';
import { PROVIDERS, PROVIDER_KEYS } from '@/lib/types';
import { selectionFeedback } from '@/lib/feedback';
import Icon from './Icon';
import ModalSheet from './ModalSheet';

const LOCALE_LABELS: Record<AppLocale, string> = {
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  en: 'English',
};

interface ControlSheetProps {
  open: boolean;
  panel: 'filters' | 'settings';
  minBattery: number;
  enabledProviders: Set<string>;
  /** Providers that operate in the viewport. */
  availableProviders: string[];
  /** Scooters per provider in the viewport with the battery choice, whether or not the provider is switched on. */
  providerCounts: Readonly<Record<string, number>>;
  /** Providers that are not sharing data right now. */
  downProviders: readonly string[];
  hasActiveFilters: boolean;
  /** What the map shows with the current choices; null while the answer is on its way. */
  showCount: number | null;
  tileLayer: 'light' | 'dark' | 'osm';
  onClose: () => void;
  onMinBatteryChange: (value: number) => void;
  onProviderToggle: (provider: string) => void;
  onResetFilters: () => void;
  onTileLayerChange: (style: 'light' | 'dark' | 'osm') => void;
}

export default function ControlSheet({
  open,
  panel,
  minBattery,
  enabledProviders,
  availableProviders,
  providerCounts,
  downProviders,
  hasActiveFilters,
  showCount,
  tileLayer,
  onClose,
  onMinBatteryChange,
  onProviderToggle,
  onResetFilters,
  onTileLayerChange,
}: ControlSheetProps) {
  const { t, locale, setLocale, formatNumber } = useI18n();
  const batteryHelpId = useId();
  const filters = panel === 'filters';
  const tap = (action: () => void) => () => { selectionFeedback(); action(); };

  const batteryPreset = snapBatteryPreset(minBattery);
  // In catalogue order, as the iOS filters list them.
  const providers = PROVIDER_KEYS.filter(key => availableProviders.includes(key)).map(key => {
    const count = providerCounts[key] ?? 0;
    return {
      key,
      ...PROVIDERS[key],
      count,
      enabled: enabledProviders.has(key),
      // Not sharing data and nothing in view, like the dashed chip in the dock.
      down: count === 0 && downProviders.includes(key),
    };
  });

  return (
    <ModalSheet
      open={open}
      title={t(filters ? 'filter.title' : 'settings.title')}
      action={filters ? (
        <button type="button" className="sheet-reset" disabled={!hasActiveFilters} onClick={tap(onResetFilters)}>
          {t('filter.reset')}
        </button>
      ) : undefined}
      footer={filters ? (
        // Filters apply as they are chosen, so this is the count on the map.
        <button type="button" className="sheet-primary" aria-live="polite" onClick={tap(onClose)}>
          {showCount === null
            ? t('dock.finding')
            : showCount === 1
              ? t('filter.show.one')
              : t('filter.show.other', { count: formatNumber(showCount) })}
        </button>
      ) : undefined}
      onClose={onClose}
    >
      {filters ? (
        <>
          <section className="settings-section">
            <h3>{t('filter.battery')}</h3>
            <div
              className="seg"
              role="group"
              aria-label={t('filter.battery')}
              aria-describedby={batteryPreset > 0 ? batteryHelpId : undefined}
              style={
                {
                  '--segment-index': BATTERY_PRESETS.indexOf(batteryPreset),
                  '--segment-count': BATTERY_PRESETS.length,
                } as CSSProperties
              }
            >
              <span className="seg-indicator" aria-hidden="true" />
              {BATTERY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={batteryPreset === preset}
                  onClick={() => {
                    if (batteryPreset === preset) return;
                    selectionFeedback();
                    onMinBatteryChange(preset);
                  }}
                >
                  {batteryPresetLabel(preset) ?? t('filter.any')}
                </button>
              ))}
            </div>
            {batteryPreset > 0 && (
              <p id={batteryHelpId} className="filter-help">{t('filter.batteryHelp')}</p>
            )}
          </section>
          <section className="settings-section">
            <h3>{t('filter.providers')}</h3>
            <div className="settings-group provider-options" role="group" aria-label={t('filter.providers')}>
              {/* No provider operates in this part of the map. */}
              {providers.length === 0 && <p className="provider-none">{t('coverage.title')}</p>}
              {providers.map((provider) => (
                <button
                  key={provider.key}
                  type="button"
                  className={provider.down ? 'provider-down' : undefined}
                  aria-pressed={provider.enabled}
                  aria-label={provider.down
                    ? t('dock.down.chip', { name: provider.name })
                    : t('providers.toggleLabel', {
                        name: provider.name,
                        count: formatNumber(provider.count),
                        state: t(provider.enabled ? 'providers.selected' : 'providers.notSelected'),
                      })}
                  onClick={tap(() => onProviderToggle(provider.key))}
                >
                  <span
                    className="provider-symbol"
                    style={{ '--provider-color': provider.color } as CSSProperties}
                  >
                    {provider.initial}
                  </span>
                  <span className="provider-copy">
                    <span>{provider.name}</span>
                    {provider.down && <span className="provider-note">{t('filter.down')}</span>}
                  </span>
                  {!provider.down && <span className="provider-count">{formatNumber(provider.count)}</span>}
                  {/* A check when shown, an empty circle when hidden, a dashed one when chosen but without data. */}
                  <span className="provider-check">
                    {provider.enabled && !provider.down && <Icon name="check" size={14} />}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="settings-section">
            <h3>{t('map.style')}</h3>
            <div className="map-style-options" role="group" aria-label={t('map.style')}>
              {(['light', 'dark', 'osm'] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  aria-pressed={tileLayer === style}
                  onClick={() => {
                    if (tileLayer !== style) selectionFeedback();
                    onTileLayerChange(style);
                  }}
                >
                  <span className={`map-style-preview map-style-${style}`} aria-hidden="true">
                    <span />
                    <i />
                    <Icon name="pin" size={20} />
                  </span>
                  <span>
                    {t(
                      style === 'light'
                        ? 'map.light'
                        : style === 'dark'
                          ? 'map.dark'
                          : 'map.osm'
                    )}
                  </span>
                  <span className="style-check">
                    {tileLayer === style && <Icon name="check" size={12} />}
                  </span>
                </button>
              ))}
            </div>
          </section>
          <section className="settings-section">
            <h3>{t('language.title')}</h3>
            <div
              className="seg"
              role="group"
              aria-label={t('language.title')}
              style={
                {
                  '--segment-index': SUPPORTED_LOCALES.indexOf(locale),
                  '--segment-count': SUPPORTED_LOCALES.length,
                } as CSSProperties
              }
            >
              <span className="seg-indicator" aria-hidden="true" />
              {SUPPORTED_LOCALES.map((language) => (
                <button
                  key={language}
                  type="button"
                  onClick={() => {
                    if (locale !== language) selectionFeedback();
                    track('language_change', { language });
                    setLocale(language);
                  }}
                  aria-pressed={locale === language}
                  lang={`${language}-CH`}
                  title={LOCALE_LABELS[language]}
                >
                  {language.toUpperCase()}
                </button>
              ))}
            </div>
          </section>
          <footer className="sheet-footer">
            <a href="/privacy">{t('links.privacy')}</a>
            <span aria-hidden="true">·</span>
            <a
              href="https://opentransportdata.swiss/en/cookbook/shared-mobility/"
              target="_blank"
              rel="noreferrer"
            >
              Mobility data
            </a>
            <span aria-hidden="true">·</span>
            <a
              href="https://transport.data.gouv.fr/datasets?type=vehicles-sharing"
              target="_blank"
              rel="noreferrer"
            >
              France: Dott, Bird, Lime, Voi, Pony
            </a>
            <span aria-hidden="true">·</span>
            <a href="https://www.mobidata-bw.de/" target="_blank" rel="noreferrer">
              MobiData BW
            </a>
            <span aria-hidden="true">·</span>
            <a href="https://github.com/MobilityData/gbfs" target="_blank" rel="noreferrer">
              DE/IT: Dott, Bolt, Hopp, Lime, Voi, Bird
            </a>
            <span aria-hidden="true">·</span>
            <a
              href="https://www.geo.admin.ch/en/geo-services/geo-services/application-programming-interface-api"
              target="_blank"
              rel="noreferrer"
            >
              Address data © swisstopo
            </a>
          </footer>
        </>
      )}
    </ModalSheet>
  );
}
