'use client';

import { track } from '@/lib/analytics';

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes } from 'react';
import type { CoveredCity } from '@/lib/coveredCities';
import { useI18n } from '@/lib/i18n';
import { placeForCity, toPlace, type Place, type PlaceResult } from '@/lib/places';
import Icon from './Icon';
import { requestDeadline } from '@/lib/requestDeadline';

/** What the map needs of a searched place. */
export interface AddressResult {
  lat: number;
  lng: number;
  display_name: string;
}

interface AddressSearchProps {
  /** Places chosen since the page was opened, most recent first. */
  recentPlaces: readonly Place[];
  /** The covered cities nearest to the map centre. */
  nearbyCities: readonly CoveredCity[];
  onSelect: (place: Place) => void;
  onLocate: () => void;
  onCancel: () => void;
}

/** What the open search shows under the field. */
type SearchStatus =
  /** Fewer than two characters typed: ways to start without typing. */
  | { kind: 'idle' }
  | { kind: 'searching' }
  /** Never empty. Enter chooses the highlighted place, the first one to begin with. */
  | { kind: 'results'; places: Place[] }
  | { kind: 'noResults' }
  /** The search could not be reached; "Try again" repeats it. */
  | { kind: 'failed' };

const SEARCH_DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;
// When the server says "too many searches" without saying for how long.
const DEFAULT_RETRY_AFTER_MS = 10_000;
const MAX_RETRY_AFTER_MS = 60_000;

/** How long to wait before searching again, from the Retry-After header of a 429 (in seconds). */
function retryAfterMs(header: string | null): number {
  const seconds = header === null || header.trim() === '' ? NaN : Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(Math.max(seconds * 1000, 1_000), MAX_RETRY_AFTER_MS);
}

/** A place in the open search: a result, or a place chosen earlier. */
function PlaceRow({
  place,
  recent = false,
  ...button
}: { place: Place; recent?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { t } = useI18n();
  const noData = !place.covered;
  return (
    <button
      type="button"
      className="place-row"
      aria-label={[place.title, place.subtitle, noData && t('find.noData')].filter(Boolean).join(', ')}
      {...button}
    >
      {/* Blue for a place with scooter data; grey for one without and for a recent place. */}
      <span className={`place-tile ${recent || noData ? 'place-tile-muted' : ''}`}>
        <Icon name={recent ? 'recent' : 'pin'} size={18} />
      </span>
      <span className="place-copy">
        <span className="place-title">{place.title}</span>
        {place.subtitle && <span className="place-subtitle">{place.subtitle}</span>}
      </span>
      {noData && <span className="place-tag">{t('find.noData')}</span>}
    </button>
  );
}

/** The open search: the field first, with Cancel beside it; under it, ways to
    start while nothing is typed and the places found from two characters on. */
export default function AddressSearch({ recentPlaces, nearbyCities, onSelect, onLocate, onCancel }: AddressSearchProps) {
  const { locale, t } = useI18n();
  const listboxId = useId();
  const recentId = useId();
  const citiesId = useId();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<SearchStatus>({ kind: 'idle' });
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  // The places found last, for a search that is refused because there were too many.
  const foundRef = useRef<Place[] | null>(null);
  const places = status.kind === 'results' ? status.places : null;

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    controllerRef.current?.abort();
  }, []);

  // The arrow keys can reach a place that the keyboard or a short window leaves
  // out of view. Only the list scrolls: the island around it clips its content
  // while it grows and must not be scrolled along.
  useEffect(() => {
    const body = bodyRef.current;
    const option = places && document.getElementById(`${listboxId}-${activeIndex}`);
    if (!body || !option) return;
    const view = body.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    if (row.top < view.top) body.scrollTop -= view.top - row.top;
    else if (row.bottom > view.bottom) body.scrollTop += row.bottom - view.bottom;
  }, [activeIndex, listboxId, places]);

  const resetPendingSearch = () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
  };

  const search = async (value: string) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const deadline = requestDeadline(controller.signal, 12_000);
    setStatus({ kind: 'searching' });

    try {
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: value, lang: locale }),
        cache: 'no-store',
        signal: deadline.signal,
      });
      if (response.status === 429) {
        if (controller.signal.aborted || controllerRef.current !== controller) return;
        // Too many searches in a minute, which typing with pauses can reach: not
        // a failure to report. What was found last stays, and the same text is
        // searched again once the server allows it, unless the text changes first.
        if (foundRef.current) {
          setActiveIndex(0);
          setStatus({ kind: 'results', places: foundRef.current });
        }
        timeoutRef.current = window.setTimeout(() => {
          timeoutRef.current = null;
          void search(value);
        }, retryAfterMs(response.headers.get('Retry-After')));
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // An answer from before the two-line labels gets today's label split and the client's own coverage.
      const found = (await response.json() as PlaceResult[]).map(toPlace);
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      track('search_results', { count: found.length });
      foundRef.current = found.length > 0 ? found : null;
      setActiveIndex(0);
      setStatus(found.length > 0 ? { kind: 'results', places: found } : { kind: 'noResults' });
    } catch {
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      track('search_error');
      setStatus({ kind: 'failed' });
    } finally {
      deadline.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const handleChange = (value: string) => {
    setQuery(value);
    resetPendingSearch();

    const normalized = value.trim();
    if (normalized.length < MIN_QUERY_LENGTH) {
      foundRef.current = null;
      setStatus({ kind: 'idle' });
      return;
    }

    setStatus({ kind: 'searching' });
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      void search(normalized);
    }, SEARCH_DEBOUNCE_MS);
  };

  // The buttons inside the panel must not take the keyboard away from the field.
  const focusField = () => inputRef.current?.focus({ preventScroll: true });

  // Empties the field, which brings the suggestions back. The chosen place is cleared from the bar.
  const clearText = () => {
    handleChange('');
    focusField();
  };

  // The same text, searched at once.
  const retry = () => {
    resetPendingSearch();
    void search(query.trim());
    focusField();
  };

  const choose = (place: Place) => {
    resetPendingSearch();
    onSelect(place);
  };

  return (
    <div className="search-panel">
      <div className="search-head">
        <div className="field">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            type="search"
            maxLength={160}
            autoFocus
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            placeholder={t('find.placeholder')}
            aria-label={t('find.placeholder')}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={places !== null}
            aria-controls={places ? listboxId : undefined}
            aria-activedescendant={places ? `${listboxId}-${activeIndex}` : undefined}
            onChange={(event) => handleChange(event.target.value)}
            onKeyDown={(event) => {
              if (!places) return;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % places.length);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => (index <= 0 ? places.length - 1 : index - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(places[activeIndex] ?? places[0]);
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="field-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={clearText}
              aria-label={t('find.clear')}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
        <button type="button" className="search-cancel" onClick={onCancel}>
          {t('find.cancel')}
        </button>
      </div>

      <div ref={bodyRef} className="search-body">
        {status.kind === 'idle' && (
          <>
            <button type="button" className="place-row place-row-location" onClick={onLocate}>
              <span className="place-tile">
                <Icon name="location" size={18} />
              </span>
              <span className="place-title">{t('find.useLocation')}</span>
            </button>

            {recentPlaces.length > 0 && (
              <>
                <p className="search-label" id={recentId}>{t('find.recent')}</p>
                <div className="place-rows" role="group" aria-labelledby={recentId}>
                  {recentPlaces.map((place) => (
                    <PlaceRow
                      key={`${place.lat}-${place.lng}-${place.display_name}`}
                      place={place}
                      recent
                      onClick={() => choose(place)}
                    />
                  ))}
                </div>
              </>
            )}

            {nearbyCities.length > 0 && (
              <>
                <p className="search-label" id={citiesId}>{t('find.cities')}</p>
                <div className="city-chips" role="group" aria-labelledby={citiesId}>
                  {nearbyCities.map((city) => (
                    <button
                      type="button"
                      key={city.id}
                      className="chip"
                      onClick={() => choose(placeForCity(city, locale))}
                    >
                      {city.city}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {places && (
          <div id={listboxId} className="place-rows" role="listbox" aria-label={t('find.results')}>
            {places.map((place, index) => (
              <PlaceRow
                key={`${place.lat}-${place.lng}-${place.display_name}`}
                place={place}
                role="option"
                id={`${listboxId}-${index}`}
                aria-selected={activeIndex === index}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => choose(place)}
              />
            ))}
          </div>
        )}

        {/* Always there, so that screen readers announce what comes to stand in it. */}
        <div role="status">
          {status.kind !== 'idle' && !places && (
            <p className="search-status">
              {status.kind === 'searching' && <span className="mini-spinner" aria-hidden="true" />}
              {status.kind === 'failed' && <Icon name="warning" size={15} />}
              {t(status.kind === 'searching' ? 'find.loading' : status.kind === 'failed' ? 'find.error' : 'find.noResults')}
            </p>
          )}
        </div>
        {status.kind === 'failed' && (
          <button
            type="button"
            className="search-retry"
            onMouseDown={(event) => event.preventDefault()}
            onClick={retry}
          >
            {t('find.retry')}
          </button>
        )}
      </div>
    </div>
  );
}
