'use client';

import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import AddressSearch from './AddressSearch';
import Icon from './Icon';
import type { CoveredCity } from '@/lib/coveredCities';
import { useI18n } from '@/lib/i18n';
import { selectionFeedback } from '@/lib/feedback';
import type { Place } from '@/lib/places';

interface SearchIslandProps {
  /** The searched place: the origin for walking times until it is cleared. */
  place: Place | null;
  /** False for a searched place outside every service area: there are no scooters to promise near it. */
  placeHasData: boolean;
  locating: boolean;
  expanded: boolean;
  hasActiveFilters: boolean;
  /** Places chosen since the page was opened, most recent first. */
  recentPlaces: readonly Place[];
  /** The covered cities nearest to the map centre. */
  nearbyCities: readonly CoveredCity[];
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (place: Place) => void;
  onClear: () => void;
  onLocate: () => void;
  onShowFilters: () => void;
  onShowSettings: () => void;
}

// What stays free between the open search and the keyboard or the bottom of the window.
const PANEL_BOTTOM_GAP = 12;
// The field and a first row remain reachable however little room is left.
const PANEL_MIN_HEIGHT = 180;

/** The search bar at the top of the map. Collapsed, it says what the map is
    based on: nothing yet, your location, a searched place, or a location on
    its way. Tapped, it opens into the search. */
export default function SearchIsland({
  place,
  placeHasData,
  locating,
  expanded,
  hasActiveFilters,
  recentPlaces,
  nearbyCities,
  onExpandedChange,
  onSelect,
  onClear,
  onLocate,
  onShowFilters,
  onShowSettings,
}: SearchIslandProps) {
  const { t } = useI18n();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const islandRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // The open search ends above the on-screen keyboard; what does not fit scrolls.
  useLayoutEffect(() => {
    const island = islandRef.current;
    const viewport = window.visualViewport;
    if (!expanded || !island || !viewport) return;
    const update = () => {
      const top = island.getBoundingClientRect().top - viewport.offsetTop;
      const room = Math.floor(viewport.height - top - PANEL_BOTTOM_GAP);
      island.style.setProperty('--search-max-h', `${Math.max(PANEL_MIN_HEIGHT, room)}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      island.style.removeProperty('--search-max-h');
    };
  }, [expanded]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const island = islandRef.current;
    if (!content || !island) return;
    const update = () => {
      island.style.height = `${Math.ceil(content.getBoundingClientRect().height)}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const setExpanded = (next: boolean) => {
    selectionFeedback();
    // Commit within the tap so mobile Safari can focus the newly mounted input.
    flushSync(() => onExpandedChange(next));
    if (!next) triggerRef.current?.focus({ preventScroll: true });
  };

  const clearPlace = () => {
    selectionFeedback();
    // The button leaves with the place; the keyboard focus stays in the bar.
    flushSync(() => onClear());
    triggerRef.current?.focus({ preventScroll: true });
  };

  // "Scooters near this place" would be untrue where there is no data.
  const placeLine = t(placeHasData ? 'bar.place.sub' : 'bar.place.noData');

  return (
    <div
      ref={islandRef}
      className={`search-island glass ${expanded ? 'search-island-expanded' : ''}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !expanded) return;
        // Closes the search instead of emptying the field, as browsers do in a search field.
        event.preventDefault();
        setExpanded(false);
      }}
    >
      <div ref={contentRef} className="search-island-inner">
        {expanded ? (
          <AddressSearch
            recentPlaces={recentPlaces}
            nearbyCities={nearbyCities}
            onSelect={(chosen) => {
              onSelect(chosen);
              setExpanded(false);
            }}
            onLocate={() => {
              onLocate();
              setExpanded(false);
            }}
            onCancel={() => setExpanded(false)}
          />
        ) : (
          <div className="island-toolbar">
            <button
              ref={triggerRef}
              type="button"
              className="bar-button"
              onClick={() => setExpanded(true)}
              aria-label={
                place
                  ? placeHasData ? t('bar.aria.place', { name: place.title }) : `${place.title}. ${placeLine}`
                  : undefined
              }
              aria-expanded={false}
            >
              {place ? (
                <>
                  <span className="place-tile"><Icon name="pin" size={18} /></span>
                  <span className="bar-copy">
                    <strong>{place.title}</strong>
                    <span>{placeLine}</span>
                  </span>
                </>
              ) : locating ? (
                <>
                  <span className="bar-lead"><span className="mini-spinner" aria-hidden="true" /></span>
                  <span className="bar-locating">{t('bar.locating')}</span>
                </>
              ) : (
                <>
                  {/* Without a place the bar reads like an empty search field, also once you are
                      located: the dot on the map says where you are. */}
                  <span className="bar-lead bar-lead-search"><Icon name="search" /></span>
                  <span className="bar-placeholder">{t('bar.empty')}</span>
                </>
              )}
            </button>
            {place && (
              <button type="button" className="icon-button bar-clear" onClick={clearPlace} aria-label={t('bar.clearPlace')}>
                <Icon name="close" size={17} />
              </button>
            )}
            <span className="toolbar-divider" />
            <button
              type="button"
              className={`icon-button ${hasActiveFilters ? 'is-active' : ''}`}
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                onShowFilters();
              }}
              aria-label={t(hasActiveFilters ? 'filters.active' : 'filters.title')}
              aria-haspopup="dialog"
            >
              <Icon name="filters" />
              {hasActiveFilters && <span className="filter-badge" />}
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                onShowSettings();
              }}
              aria-label={t('bar.settings')}
              aria-haspopup="dialog"
            >
              <Icon name="more" size={22} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
