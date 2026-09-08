'use client';

import { track } from '@/lib/analytics';

import { useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import Icon from './Icon';
import { requestDeadline } from '@/lib/requestDeadline';

export interface AddressResult {
  lat: number;
  lng: number;
  display_name: string;
}

interface AddressSearchProps {
  onSelect: (result: AddressResult) => void;
  onClear: () => void;
  compact?: boolean;
  autoFocus?: boolean;
  initialQuery?: string;
}

const SEARCH_DEBOUNCE_MS = 350;

function addressParts(displayName: string): { title: string; subtitle: string } {
  const [title, ...rest] = displayName.split(',').map(part => part.trim()).filter(Boolean);
  return { title: title || displayName, subtitle: rest.join(', ') };
}

export default function AddressSearch({ onSelect, onClear, compact = false, autoFocus = false, initialQuery = '' }: AddressSearchProps) {
  const { locale, t } = useI18n();
  const listboxId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<AddressResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [failed, setFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const timeoutRef = useRef<number | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    controllerRef.current?.abort();
  }, []);

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
    setLoading(true);
    setFailed(false);

    try {
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: value, lang: locale }),
        cache: 'no-store',
        signal: deadline.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextResults = await response.json() as AddressResult[];
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      track('search_results', { count: nextResults.length });
      setResults(nextResults);
      setActiveIndex(nextResults.length > 0 ? 0 : -1);
      setSearched(true);
    } catch {
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      setResults([]);
      setActiveIndex(-1);
      setSearched(true);
      track('search_error');
      setFailed(true);
    } finally {
      deadline.dispose();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  };

  const handleChange = (value: string) => {
    setQuery(value);
    setResults([]);
    setActiveIndex(-1);
    setSearched(false);
    setFailed(false);
    resetPendingSearch();
    onClear();

    const normalized = value.trim();
    if (normalized.length < 2) {
      setLoading(false);
      return;
    }

    setLoading(true);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      void search(normalized);
    }, SEARCH_DEBOUNCE_MS);
  };

  const selectResult = (result: AddressResult) => {
    resetPendingSearch();
    setQuery(result.display_name);
    setResults([]);
    setActiveIndex(-1);
    setSearched(false);
    setFailed(false);
    setLoading(false);
    onSelect(result);
  };

  const clear = () => {
    track('search_clear');
    resetPendingSearch();
    setQuery('');
    setResults([]);
    setActiveIndex(-1);
    setSearched(false);
    setFailed(false);
    setLoading(false);
    onClear();
  };

  const expanded = results.length > 0;

  return (
    <div className={`address-search ${compact ? 'address-search-compact' : 'section'}`}>
      {!compact && <div className="section-title">{t('search.title')}</div>}
      <div className="field">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <input
          type="search"
          maxLength={160}
          autoFocus={autoFocus}
          enterKeyHint="search"
          autoComplete="off"
          value={query}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && results.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % results.length);
            } else if (event.key === 'ArrowUp' && results.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
            } else if (event.key === 'Enter' && activeIndex >= 0) {
              event.preventDefault();
              selectResult(results[activeIndex]);
            } else if (event.key === 'Escape') {
              if (!expanded) return;
              event.preventDefault();
              setResults([]);
              setActiveIndex(-1);
            }
          }}
        />
        {loading && <span className="mini-spinner" aria-hidden="true" />}
        {query && !loading && (
          <button type="button" className="field-btn" onClick={clear} aria-label={t('search.clear')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="m7 7 10 10M17 7 7 17" />
            </svg>
          </button>
        )}
      </div>

      {expanded && (
        <div id={listboxId} className="results" role="listbox" aria-label={t('search.results')}>
          {results.map((result, index) => {
            const parts = addressParts(result.display_name);
            return (
              <button
                type="button"
                role="option"
                id={`${listboxId}-${index}`}
                key={`${result.lat}-${result.lng}-${result.display_name}`}
                aria-selected={activeIndex === index}
                aria-label={result.display_name}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectResult(result)}
              >
                <span className="result-symbol"><Icon name="pin" size={19} /></span>
                <span className="result-copy"><span className="result-title">{parts.title}</span>
                {parts.subtitle && <span className="result-subtitle">{parts.subtitle}</span>}</span>
              </button>
            );
          })}
        </div>
      )}

      {!expanded && (loading || searched) && (
        <div className={`search-status ${failed ? 'search-status-error' : ''}`} role="status">
          {loading ? t('search.loading') : failed ? t('search.error') : t('search.noResults')}
        </div>
      )}
    </div>
  );
}
