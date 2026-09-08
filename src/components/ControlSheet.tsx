'use client';

import { track } from '@/lib/analytics';

import { useEffect, useRef, type CSSProperties } from 'react';
import { SUPPORTED_LOCALES, useI18n, type AppLocale } from '@/lib/i18n';
import { PROVIDERS } from '@/lib/types';
import { prefersReducedMotion, selectionFeedback } from '@/lib/feedback';
import Icon from './Icon';

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
  availableProviders: string[];
  hasActiveFilters: boolean;
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
  hasActiveFilters,
  tileLayer,
  onClose,
  onMinBatteryChange,
  onProviderToggle,
  onResetFilters,
  onTileLayerChange,
}: ControlSheetProps) {
  const { t, locale, setLocale, formatNumber } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dragRef = useRef<{ y: number; time: number } | null>(null);
  const backdropPressedRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    let animation: Animation | undefined;
    if (open) {
      if (!dialog.open) dialog.showModal();
      if (!prefersReducedMotion())
        animation = dialog.animate(
          [
            { opacity: 0, transform: 'translateY(32px) scale(0.98)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        );
    } else if (dialog.open) {
      if (prefersReducedMotion()) dialog.close();
      else {
        animation = dialog.animate(
          [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateY(24px)' },
          ],
          { duration: 160, easing: 'ease-in', fill: 'forwards' }
        );
        animation.onfinish = () => {
          dialog.close();
          animation?.cancel();
        };
      }
    }
    return () => animation?.cancel();
  }, [open]);

  const close = () => {
    selectionFeedback();
    onClose();
  };
  const releaseDrag = () => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const transform = dialog.style.transform;
    dialog.style.transform = '';
    if (transform && !prefersReducedMotion())
      dialog.animate([{ transform }, { transform: 'none' }], {
        duration: 200,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
  };

  return (
    <dialog
      ref={dialogRef}
      className="control-sheet glass"
      aria-labelledby="control-sheet-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        backdropPressedRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropPressedRef.current && event.target === event.currentTarget) close();
      }}
    >
      <div className="control-sheet-inner">
        <div
          className="modal-grab-area"
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            dragRef.current = { y: event.clientY, time: performance.now() };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!dragRef.current || !dialogRef.current || prefersReducedMotion()) return;
            const delta = Math.max(0, event.clientY - dragRef.current.y);
            dialogRef.current.style.transform = `translateY(${delta * 0.5}px)`;
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current;
            dragRef.current = null;
            if (!drag) return;
            const delta = event.clientY - drag.y;
            const elapsed = Math.max(1, performance.now() - drag.time);
            if (delta > 70 || (delta > 20 && delta / elapsed > 0.5)) {
              if (dialogRef.current) dialogRef.current.style.transform = '';
              close();
            } else releaseDrag();
          }}
          onPointerCancel={() => {
            dragRef.current = null;
            releaseDrag();
          }}
        >
          <span className="grabber" />
        </div>
        <header className="control-sheet-heading">
          <h2 id="control-sheet-title">
            {t(panel === 'filters' ? 'filters.title' : 'settings.title')}
          </h2>
          <button type="button" className="done-button" onClick={close}>
            {t('common.done')}
          </button>
        </header>
        <div className="control-sheet-body">
          {panel === 'filters' ? (
            <>
              <section className="settings-section">
                <div className="section-heading">
                  <h3>{t('filters.minBattery')}</h3>
                  <span className="slider-val">
                    {minBattery === 0 ? t('filters.any') : `${formatNumber(minBattery)}%`}
                  </span>
                </div>
                <div className="settings-group battery-filter">
                  <div className="battery-slider">
                    <Icon name="battery" />
                    <input
                      type="range"
                      className="ios-slider"
                      min={0}
                      max={100}
                      step={5}
                      value={minBattery}
                      aria-label={t('filters.minBattery')}
                      aria-valuetext={
                        minBattery === 0 ? t('filters.any') : `${formatNumber(minBattery)}%`
                      }
                      style={{ '--fill': `${minBattery}%` } as CSSProperties}
                      onChange={(event) => {
                        selectionFeedback();
                        onMinBatteryChange(Number(event.target.value));
                      }}
                    />
                  </div>
                  <div className="slider-labels" aria-hidden="true">
                    <span>{t('filters.any')}</span>
                    <span>100%</span>
                  </div>
                </div>
                {minBattery > 0 && <p className="filter-help">{t('filters.unknownBattery')}</p>}
              </section>
              <section className="settings-section">
                <div className="section-heading">
                  <h3>{t('providers.title')}</h3>
                  {hasActiveFilters && (
                    <button
                      className="text-button"
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
                <div className="settings-group provider-options">
                  {availableProviders
                    .filter((key) => PROVIDERS[key])
                    .map((key) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={enabledProviders.has(key)}
                        onClick={() => {
                          selectionFeedback();
                          onProviderToggle(key);
                        }}
                      >
                        <span
                          className="provider-symbol"
                          style={{ '--provider-color': PROVIDERS[key].color } as CSSProperties}
                        >
                          {PROVIDERS[key].initial}
                        </span>
                        <span>{PROVIDERS[key].name}</span>
                        <span className="provider-check">
                          {enabledProviders.has(key) && <Icon name="check" size={14} />}
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
        </div>
      </div>
    </dialog>
  );
}
