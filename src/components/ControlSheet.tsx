'use client';

import { track } from '@/lib/analytics';

import { useId, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { BATTERY_PRESETS, batteryPresetLabel, snapBatteryPreset } from '@/lib/battery';
import type { MapStyleName, ThemeName } from '@/lib/clientParams';
import { SUPPORTED_LOCALES, useI18n, type AppLocale, type TranslationKey } from '@/lib/i18n';
import { isSingular } from '@/lib/uiText';
import { PROVIDERS, PROVIDER_KEYS } from '@/lib/types';
import { providerSurfaceColor } from '@/lib/providerColor';
import { selectionFeedback } from '@/lib/feedback';
import Icon from './Icon';
import { CreditsList } from './MapCredits';
import ModalSheet from './ModalSheet';

const LOCALE_LABELS: Record<AppLocale, string> = {
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  en: 'English',
};

const THEMES: { name: ThemeName; label: TranslationKey }[] = [
  { name: 'auto', label: 'set.auto' },
  { name: 'light', label: 'set.light' },
  { name: 'dark', label: 'set.dark' },
];

const MAP_STYLES: { name: MapStyleName; label: TranslationKey }[] = [
  { name: 'calm', label: 'set.calm' },
  { name: 'detailed', label: 'set.detailed' },
];

const SOURCE_CODE_URL = 'https://github.com/plhery/swiss-scooters';

interface ControlSheetProps {
  open: boolean;
  panel: 'filters' | 'settings';
  minBattery: number;
  enabledProviders: Set<string>;
  /** Providers that operate in the viewport. */
  availableProviders: string[];
  /** Scooters per provider in the viewport with the battery choice, whether or not the provider is switched on. */
  providerCounts: Readonly<Record<string, number>>;
  /** Providers that are not sharing data right now and so have nothing in view, from providerHealth(). */
  downProviders: readonly string[];
  hasActiveFilters: boolean;
  /** What the map shows with the current choices; null while the answer is on its way. */
  showCount: number | null;
  /** Automatic follows the system. */
  theme: ThemeName;
  mapStyle: MapStyleName;
  onClose: () => void;
  onMinBatteryChange: (value: number) => void;
  onProviderToggle: (provider: string) => void;
  onResetFilters: () => void;
  onThemeChange: (theme: ThemeName) => void;
  onMapStyleChange: (style: MapStyleName) => void;
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
  theme,
  mapStyle,
  onClose,
  onMinBatteryChange,
  onProviderToggle,
  onResetFilters,
  onThemeChange,
  onMapStyleChange,
}: ControlSheetProps) {
  const { t, locale, setLocale, formatNumber } = useI18n();
  const batteryHelpId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const creditsRowRef = useRef<HTMLButtonElement>(null);
  const [creditsShown, setCreditsShown] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  // The settings open on their first view, whatever they showed when they were closed.
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setCreditsShown(false);
  }
  const filters = panel === 'filters';
  const credits = !filters && creditsShown;
  const tap = (action: () => void) => () => { selectionFeedback(); action(); };

  // Committed within the tap, so that the focus can follow to where the view changed.
  const showCredits = () => {
    selectionFeedback();
    flushSync(() => setCreditsShown(true));
    titleRef.current?.focus();
  };
  const hideCredits = () => {
    selectionFeedback();
    flushSync(() => setCreditsShown(false));
    creditsRowRef.current?.focus();
  };

  const batteryPreset = snapBatteryPreset(minBattery);
  // In catalogue order, as the iOS filters list them.
  const providers = PROVIDER_KEYS.filter(key => availableProviders.includes(key)).map(key => {
    const count = providerCounts[key] ?? 0;
    return {
      key,
      ...PROVIDERS[key],
      count,
      enabled: enabledProviders.has(key),
      // Like the dashed chip in the dock.
      down: downProviders.includes(key),
    };
  });

  return (
    <ModalSheet
      open={open}
      title={t(filters ? 'filter.title' : credits ? 'set.credits' : 'set.title')}
      titleRef={titleRef}
      back={credits ? { label: t('set.title'), onClick: hideCredits } : undefined}
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
            : t(isSingular(showCount, locale) ? 'filter.show.one' : 'filter.show.other', { count: formatNumber(showCount) })}
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
                    style={{ '--provider-color': providerSurfaceColor(provider.key, provider.color) } as CSSProperties}
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
      ) : credits ? (
        <div className="settings-group credits-rows">
          <CreditsList />
        </div>
      ) : (
        <>
          <section className="settings-section">
            <h3>{t('set.appearance')}</h3>
            <div
              className="seg"
              role="group"
              aria-label={t('set.appearance')}
              style={
                {
                  '--segment-index': THEMES.findIndex(({ name }) => name === theme),
                  '--segment-count': THEMES.length,
                } as CSSProperties
              }
            >
              <span className="seg-indicator" aria-hidden="true" />
              {THEMES.map(({ name, label }) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={theme === name}
                  onClick={() => {
                    if (theme === name) return;
                    selectionFeedback();
                    onThemeChange(name);
                  }}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </section>
          <section className="settings-section">
            <h3>{t('set.map')}</h3>
            <div className="map-style-options" role="group" aria-label={t('set.map')}>
              {MAP_STYLES.map(({ name, label }) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={mapStyle === name}
                  onClick={() => {
                    if (mapStyle === name) return;
                    selectionFeedback();
                    onMapStyleChange(name);
                  }}
                >
                  <span className={`map-style-preview map-style-${name}`} aria-hidden="true">
                    <span />
                  </span>
                  {t(label)}
                </button>
              ))}
            </div>
          </section>
          <section className="settings-section">
            <h3>{t('set.language')}</h3>
            <div className="language-options" role="group" aria-label={t('set.language')}>
              {SUPPORTED_LOCALES.map((language) => (
                <button
                  key={language}
                  type="button"
                  aria-pressed={locale === language}
                  lang={`${language}-CH`}
                  onClick={() => {
                    if (locale === language) return;
                    selectionFeedback();
                    track('language_change', { language });
                    setLocale(language);
                  }}
                >
                  {LOCALE_LABELS[language]}
                </button>
              ))}
            </div>
          </section>
          <section className="settings-section">
            <h3>{t('set.about')}</h3>
            <div className="settings-group about-rows">
              <button ref={creditsRowRef} type="button" onClick={showCredits}>
                {t('set.credits')}
                <Icon name="chevron" size={16} strokeWidth={2.2} />
              </button>
              <a href="/privacy">
                {t('set.privacy')}
                <Icon name="chevron" size={16} strokeWidth={2.2} />
              </a>
              <a href={SOURCE_CODE_URL} target="_blank" rel="noreferrer">
                {t('set.source')}
                <Icon name="chevron" size={16} strokeWidth={2.2} />
              </a>
            </div>
          </section>
        </>
      )}
    </ModalSheet>
  );
}
