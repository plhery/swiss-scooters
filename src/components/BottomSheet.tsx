'use client';

import { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import { PROVIDERS } from '@/lib/types';

interface GeoResult {
  lat: number;
  lng: number;
  display_name: string;
}

interface BottomSheetProps {
  destination: [number, number] | null;
  radius: number;
  minBattery: number;
  corridorWidth: number;
  enabledProviders: Set<string>;
  providerCounts: Record<string, number>;
  totalCount: number;
  loading: boolean;
  lastUpdated: Date | null;
  tileLayer: 'dark' | 'light' | 'osm';
  onDestinationChange: (lat: number, lng: number) => void;
  onDestinationClear: () => void;
  onRadiusChange: (r: number) => void;
  onMinBatteryChange: (b: number) => void;
  onCorridorWidthChange: (w: number) => void;
  onProviderSelect: (p: string) => void;
  onTileLayerChange: (t: 'dark' | 'light' | 'osm') => void;
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

function SearchField({
  id, placeholder, icon, value, onValue, results, onPick, trailing,
}: {
  id: string;
  placeholder: string;
  icon: React.ReactNode;
  value: string;
  onValue: (v: string) => void;
  results: GeoResult[];
  onPick: (r: GeoResult) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div>
      <div className="field">
        {icon}
        <input
          id={id}
          type="text"
          value={value}
          onChange={e => onValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
        />
        {trailing}
      </div>
      {results.length > 0 && (
        <div className="results" role="listbox">
          {results.map((r, i) => (
            <button key={i} role="option" aria-selected={false} onClick={() => onPick(r)}>
              {r.display_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const FlagIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 22V4c0-1 .6-2 2.5-2S10 3 12 3s3.5-1 5.5-1S20 3 20 4v10c0 1-.6 2-2.5 2S14 15 12 15s-3.5 1-5.5 1S4 15 4 15" />
  </svg>
);

export default function BottomSheet({
  destination,
  radius,
  minBattery,
  corridorWidth,
  enabledProviders,
  providerCounts,
  totalCount,
  loading,
  lastUpdated,
  tileLayer,
  onDestinationChange,
  onDestinationClear,
  onRadiusChange,
  onMinBatteryChange,
  onCorridorWidthChange,
  onProviderSelect,
  onTileLayerChange,
}: BottomSheetProps) {
  const [expanded, setExpanded] = useState(false);
  const [peekH, setPeekH] = useState(160);
  const [destQuery, setDestQuery] = useState('');
  const [destResults, setDestResults] = useState<GeoResult[]>([]);
  const destTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const destRequestRef = useRef<AbortController | null>(null);

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

  useEffect(() => {
    return () => {
      clearTimeout(destTimerRef.current);
      destRequestRef.current?.abort();
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
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
    flushSync(() => setExpanded(next));
    sheet.style.transition = '';
    sheet.style.transform = '';
  };

  const geocodeDestination = useCallback(async (q: string) => {
    if (q.trim().length < 3) {
      setDestResults([]);
      return;
    }

    destRequestRef.current?.abort();
    const controller = new AbortController();
    destRequestRef.current = controller;

    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        setDestResults([]);
        return;
      }
      setDestResults(await res.json());
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setDestResults([]);
    }
  }, []);

  const handleDestInput = (val: string) => {
    setDestQuery(val);
    clearTimeout(destTimerRef.current);
    if (val.trim().length < 3) {
      destRequestRef.current?.abort();
      setDestResults([]);
      return;
    }
    destTimerRef.current = setTimeout(() => geocodeDestination(val), 300);
  };

  const updatedLabel = loading
    ? 'Updating…'
    : lastUpdated
      ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : 'near you';

  return (
    <div
      ref={sheetRef}
      className={`sheet glass ${expanded ? 'sheet-expanded' : ''}`}
      style={{ '--peek-h': `${peekH}px` } as React.CSSProperties}
      role="region"
      aria-label="Scooter search controls"
    >
      <div ref={peekRef} className="sheet-peek">
        <div
          className="sheet-handle"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse controls' : 'Expand controls'}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpanded(x => !x);
            }
          }}
        >
          <div className="grabber" aria-hidden="true" />
          <div className="sheet-title-row">
            <div>
              <div className="sheet-count" aria-live="polite">
                <span className="sheet-count-num">{totalCount}</span>
                scooter{totalCount !== 1 ? 's' : ''}
              </div>
              <div className="sheet-sub">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {loading && <span className="mini-spinner" aria-hidden="true" />}
                  {updatedLabel}
                </span>
              </div>
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
          aria-label="Filter scooters by provider"
        >
          {Object.entries(PROVIDERS).map(([key, cfg]) => {
            const on = enabledProviders.has(key);
            const onlyProvider = on && enabledProviders.size === 1;
            const clickAction = onlyProvider ? 'show all' : 'show only';
            return (
              <button
                key={key}
                className={`chip ${on ? '' : 'chip-off'}`}
                style={on ? { background: `${cfg.color}1f` } : undefined}
                onClick={() => onProviderSelect(key)}
                aria-pressed={on}
                aria-label={`${cfg.name}, ${providerCounts[key] ?? 0}. ${clickAction}.`}
                title={onlyProvider ? 'Show all providers' : `Show only ${cfg.name}`}
              >
                <span className="chip-dot" style={{ background: cfg.color }} aria-hidden="true" />
                {cfg.name}
                <span className="chip-count">{providerCounts[key] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="sheet-body" inert={!expanded}>
        <div className="section section-route">
          <div className="section-heading">
            <div className="section-title">Destination</div>
            <span>Optional</span>
          </div>
          <SearchField
            id="dest-input"
            placeholder="Where are you going?"
            icon={FlagIcon}
            value={destQuery}
            onValue={handleDestInput}
            results={destResults}
            onPick={r => {
              onDestinationChange(r.lat, r.lng);
              setDestQuery(r.display_name);
              setDestResults([]);
            }}
            trailing={destination ? (
              <button
                className="field-btn"
                style={{ color: 'var(--ink-3)' }}
                onClick={() => { onDestinationClear(); setDestQuery(''); setDestResults([]); }}
                aria-label="Clear destination"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            ) : undefined}
          />
          {destination && (
            <div style={{ marginTop: 12 }}>
              <SliderRow
                label="Corridor width"
                value={corridorWidth}
                display={`${corridorWidth} m`}
                min={50}
                max={200}
                onChange={onCorridorWidthChange}
              />
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-title">Filters</div>
          <SliderRow
            label="Search radius"
            value={radius}
            display={radius >= 1000 ? `${(radius / 1000).toFixed(radius % 1000 === 0 ? 0 : 1)} km` : `${radius} m`}
            min={100}
            max={2000}
            step={50}
            onChange={onRadiusChange}
          />
          <SliderRow
            label="Min. battery"
            value={minBattery}
            display={minBattery === 0 ? 'Any' : `${minBattery}%`}
            min={0}
            max={100}
            step={5}
            onChange={onMinBatteryChange}
          />
        </div>

        <div className="section">
          <div className="section-title">Map style</div>
          <div className="seg" role="group" aria-label="Map style">
            {(['light', 'dark', 'osm'] as const).map(t => (
              <button
                key={t}
                onClick={() => onTileLayerChange(t)}
                aria-pressed={tileLayer === t}
              >
                {t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'OSM'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
