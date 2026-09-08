'use client';

import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import AddressSearch, { type AddressResult } from './AddressSearch';
import Icon from './Icon';
import { useI18n } from '@/lib/i18n';
import { selectionFeedback } from '@/lib/feedback';

interface SearchIslandProps {
  address: AddressResult | null;
  hasLocation: boolean;
  expanded: boolean;
  hasActiveFilters: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (result: AddressResult) => void;
  onClear: () => void;
  onLocate: () => void;
  onShowFilters: () => void;
  onShowSettings: () => void;
}

export default function SearchIsland({
  address,
  hasLocation,
  expanded,
  hasActiveFilters,
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
  const title =
    address?.display_name.split(',')[0] ??
    t(hasLocation ? 'search.currentLocation' : 'search.chooseOrigin');

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

  return (
    <div
      ref={islandRef}
      className={`search-island glass ${expanded ? 'search-island-expanded' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) setExpanded(false);
      }}
    >
      <div ref={contentRef} className="search-island-inner">
        {expanded ? (
          <div className="search-island-content">
            <div className="island-heading">
              <Icon name="origin" />
              <h1>{t('search.nearby')}</h1>
              <button type="button" className="text-button" onClick={() => setExpanded(false)}>
                {t('common.done')}
              </button>
            </div>
            <AddressSearch
              compact
              autoFocus
              initialQuery={address?.display_name}
              onClear={onClear}
              onSelect={(result) => {
                onSelect(result);
                setExpanded(false);
              }}
            />
            <div className="search-actions">
              <button
                type="button"
                onClick={() => {
                  onLocate();
                  setExpanded(false);
                }}
              >
                <Icon name="location" size={17} />
                {t('intro.useLocation')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  onShowFilters();
                }}
              >
                <Icon name="filters" size={18} />
                {t('filters.title')}
              </button>
            </div>
          </div>
        ) : (
          <div className="island-toolbar">
            <button
              ref={triggerRef}
              type="button"
              className="origin-button"
              onClick={() => setExpanded(true)}
              aria-label={t('search.changeOrigin', { name: title })}
              aria-expanded={false}
            >
              <span className="origin-symbol">
                <Icon name="origin" size={27} />
              </span>
              <span className="origin-copy">
                <strong>{title}</strong>
                <span>{t('search.change')}</span>
              </span>
              <Icon name="search" size={17} />
            </button>
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
              aria-label={t('settings.more')}
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
