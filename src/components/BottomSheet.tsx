'use client';

import { useState, useRef, useLayoutEffect, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { PROVIDERS } from '@/lib/types';
import { SUPPORTED_LOCALES, useI18n, type AppLocale } from '@/lib/i18n';

interface BottomSheetProps {
  minBattery: number;
  enabledProviders: Set<string>;
  providerCounts: Record<string, number>;
  totalCount: number;
  loading: boolean;
  lastUpdated: Date | null;
  dataHealthNotice: string | null;
  tileLayer: 'dark' | 'light' | 'osm';
  onMinBatteryChange: (b: number) => void;
  onShowAllProviders: () => void;
  onProviderSelect: (p: string) => void;
  onTileLayerChange: (t: 'dark' | 'light' | 'osm') => void;
  onExpandedChange: (expanded: boolean) => void;
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
  onChange: (v: number) => void;
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
        onChange={e => onChange(parseInt(e.target.value))}
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
  onMinBatteryChange,
  onShowAllProviders,
  onProviderSelect,
  onTileLayerChange,
  onExpandedChange,
}: BottomSheetProps) {
  const { locale, setLocale, t, formatNumber } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [peekH, setPeekH] = useState(160);
  const desktopPanel = useDesktopPanel();
  const controlsVisible = desktopPanel || expanded;
  const providerKeys = Object.keys(PROVIDERS);
  const allProvidersSelected =
    enabledProviders.size === providerKeys.length &&
    providerKeys.every((provider) => enabledProviders.has(provider));
  const allProviderCount = providerKeys.reduce(
    (count, provider) => count + (providerCounts[provider] ?? 0),
    0
  );

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
    const el = peekRef.current;
    if (!el) return;
    const update = () => {
      const height = el.offsetHeight;
      setPeekH(height);
      document.documentElement.style.setProperty('--sheet-peek-h', `${height}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--sheet-peek-h');
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (desktopPanel) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const max = Math.max(sheet.offsetHeight - peekH, 0);
    dragRef.current = {
      startY: e.clientY,
      base: expanded ? 0 : max,
      max,
      moved: false,
      lastY: e.clientY,
      lastT: performance.now(),
      vel: 0,
    };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    sheet.style.transition = 'none';
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (desktopPanel) return;
    const d = dragRef.current;
    const sheet = sheetRef.current;
    if (!d || !sheet) return;
    const delta = e.clientY - d.startY;
    if (Math.abs(delta) > 4) d.moved = true;
    const now = performance.now();
    const dt = now - d.lastT;
    if (dt > 0) d.vel = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = now;
    const off = Math.min(Math.max(d.base + delta, 0), d.max);
    sheet.style.transform = `translate3d(0, ${off}px, 0)`;
  };

  const handlePointerEnd = (e: React.PointerEvent) => {
    if (desktopPanel) return;
    const d = dragRef.current;
    const sheet = sheetRef.current;
    if (!d || !sheet) return;
    dragRef.current = null;

    let next: boolean;
    if (!d.moved) {
      next = !expanded; // tap toggles
    } else {
      const off = Math.min(Math.max(d.base + (e.clientY - d.startY), 0), d.max);
      // Flick beats position
      next = Math.abs(d.vel) > 0.4 ? d.vel < 0 : off < d.max / 2;
    }
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
          time: lastUpdated.toLocaleTimeString(`${locale}-CH`, { hour: '2-digit', minute: '2-digit' }),
        })
      : t('sheet.onMap');

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
          onKeyDown={desktopPanel ? undefined : e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              const next = !expanded;
              setExpanded(next);
              onExpandedChange(next);
            }
          }}
        >
          <div className="grabber" aria-hidden="true" />
          <div className="sheet-title-row">
            <div>
              <div className="sheet-count" aria-live="polite">
                <span className="sheet-count-num">{formatNumber(totalCount)}</span>
                {totalCount === 1 ? t('sheet.scooter') : t('sheet.scooters')}
              </div>
              <div className="sheet-sub">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {loading && <span className="mini-spinner" aria-hidden="true" />}
                  {updatedLabel}
                </span>
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

        <div
          className="chips"
          role="group"
          aria-label={t('providers.filter')}
        >
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
          {Object.entries(PROVIDERS).map(([key, cfg]) => {
            const onlyProvider = enabledProviders.size === 1 && enabledProviders.has(key);
            return (
              <button
                key={key}
                className={`chip ${onlyProvider ? '' : 'chip-off'}`}
                style={onlyProvider ? { background: `${cfg.color}1f` } : undefined}
                onClick={() => onProviderSelect(key)}
                aria-pressed={onlyProvider}
                aria-label={t('providers.showOnlyLabel', {
                  name: cfg.name,
                  count: formatNumber(providerCounts[key] ?? 0),
                })}
                title={t('providers.showOnly', { name: cfg.name })}
              >
                <span className="chip-dot" style={{ background: cfg.color }} aria-hidden="true" />
                {cfg.name}
                <span className="chip-count">{formatNumber(providerCounts[key] ?? 0)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div id="scooter-controls-body" className="sheet-body" inert={!controlsVisible}>
        <div className="section">
          <div className="section-title">{t('filters.title')}</div>
          <SliderRow
            label={t('filters.minBattery')}
            value={minBattery}
            display={minBattery === 0 ? t('filters.any') : `${formatNumber(minBattery)}%`}
            min={0}
            max={100}
            step={5}
            onChange={onMinBatteryChange}
          />
        </div>

        <div className="section">
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

        <div className="section">
          <div className="section-title">{t('language.title')}</div>
          <div className="seg" role="group" aria-label={t('language.title')}>
            {SUPPORTED_LOCALES.map((language) => (
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
      </div>
    </div>
  );
}
