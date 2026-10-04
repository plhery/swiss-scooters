'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { NearbyCoveredCity } from '@/lib/coveredCities';
import {
  formatCoverageCity,
  type DockChips,
  type DockIssue,
  type DockModel,
  type DockStatus,
} from '@/lib/dockModel';
import { selectionFeedback } from '@/lib/feedback';
import { useI18n } from '@/lib/i18n';
import { formatFilterSummary } from '@/lib/nothingToShow';
import { PROVIDERS } from '@/lib/types';
import { formatUiText } from '@/lib/uiText';
import Icon from './Icon';
import ParkingCard, { type SelectedParking } from './ParkingCard';
import ScooterCard, { type SelectedVehicle } from './ScooterCard';

interface BottomSheetProps {
  /** What the dock shows while nothing is selected, from dockModel(). */
  dock: DockModel;
  /** Trouble with the data, for the line above a card, from dockIssue(). */
  issue: DockIssue | null;
  /** A scooter or a parking bay, never both: selecting one clears the other. */
  selectedVehicle: SelectedVehicle | null;
  selectedParking: SelectedParking | null;
  hidden: boolean;
  onShowAllProviders: () => void;
  onProviderToggle: (provider: string) => void;
  onClearSelection: () => void;
  onResetFilters: () => void;
  onEditFilters: () => void;
  /** Fetches at once; "Try again" exists only where a failure is shown. */
  onRetry: () => void;
  onCitySelect: (city: NearbyCoveredCity) => void;
  onLocate: () => void;
}

function tap(action: () => void) {
  return () => {
    selectionFeedback();
    action();
  };
}

function StatusText({ status }: { status: DockStatus }) {
  const i18n = useI18n();
  return (
    <div className={`sheet-sub ${status.kind === 'failure' ? 'sheet-sub-warning' : ''}`}>
      {status.kind === 'live' && <span className="freshness-dot" aria-hidden="true" />}
      {status.kind === 'failure' && <Icon name="warning" size={13} strokeWidth={2.2} />}
      <span>{formatUiText(status.text, i18n)}</span>
    </div>
  );
}

function RetryButton({ className, busy, onRetry, children }: {
  className: string;
  busy: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={`${className} retry-button`} aria-busy={busy} onClick={tap(onRetry)}>
      <span>{children}</span>
    </button>
  );
}

function ProviderChips({ chips, onShowAll, onToggle }: {
  chips: DockChips;
  onShowAll: () => void;
  onToggle: (provider: string) => void;
}) {
  const { t, formatNumber } = useI18n();
  return (
    <div className="chips" role="group" aria-label={t('providers.filter')}>
      <button
        type="button"
        className={`chip ${chips.allSelected ? 'chip-selected' : ''}`}
        onClick={() => {
          if (!chips.allSelected) selectionFeedback();
          onShowAll();
        }}
        aria-pressed={chips.allSelected}
        aria-label={t('providers.allLabel', { count: formatNumber(chips.allCount) })}
      >
        <Icon name="grid" size={14} />
        {t('providers.all')}
        <span className="chip-count">{formatNumber(chips.allCount)}</span>
      </button>
      {chips.providers.map((chip) => (
        <button
          type="button"
          key={chip.provider}
          className={`chip ${chip.down ? 'chip-down' : chip.selected ? 'chip-selected' : ''}`}
          onClick={tap(() => onToggle(chip.provider))}
          aria-pressed={chip.enabled}
          aria-label={chip.down
            ? t('dock.down.chip', { name: chip.name })
            : t('providers.toggleLabel', {
                name: chip.name,
                count: formatNumber(chip.count),
                state: t(chip.enabled ? 'providers.selected' : 'providers.notSelected'),
              })}
        >
          <span
            className="chip-dot"
            style={{ background: PROVIDERS[chip.provider].color }}
            aria-hidden="true"
          />
          {chip.name}
          {chip.down
            ? <Icon name="warning" size={14} className="chip-warning" />
            : <span className="chip-count">{formatNumber(chip.count)}</span>}
        </button>
      ))}
    </div>
  );
}

/** A card hides the count and the status line, so trouble with the data moves to one line above it. */
function CardIssue({ issue, onRetry }: { issue: DockIssue; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="dock-issue" role="status">
      <StatusText status={issue.status} />
      {issue.retry && (
        <RetryButton className="dock-retry" busy={issue.busy} onRetry={onRetry}>
          {t('dock.tryAgain')}
        </RetryButton>
      )}
    </div>
  );
}

/** The head of a card that replaces the count and the chips: a tinted symbol, a title, a sentence. */
function StateHead({ icon, tone, title, body, alert = false }: {
  icon: 'clock' | 'map' | 'filters';
  tone: 'warning' | 'info';
  title: string;
  body: string;
  alert?: boolean;
}) {
  return (
    <div className="state-head">
      <span className={`state-symbol state-symbol-${tone}`}>
        <Icon name={icon} size={21} />
      </span>
      <div className="state-copy" role={alert ? 'alert' : undefined}>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
    </div>
  );
}

export default function BottomSheet({
  dock,
  issue,
  selectedVehicle,
  selectedParking,
  hidden,
  onShowAllProviders,
  onProviderToggle,
  onClearSelection,
  onResetFilters,
  onEditFilters,
  onRetry,
  onCitySelect,
  onLocate,
}: BottomSheetProps) {
  const i18n = useI18n();
  const { t, formatNumber } = i18n;
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const text = (value: Parameters<typeof formatUiText>[0]) => formatUiText(value, i18n);

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

  let content: ReactNode;
  if (selectedVehicle) {
    const { vehicle } = selectedVehicle;
    content = (
      <>
        {issue && <CardIssue issue={issue} onRetry={onRetry} />}
        <ScooterCard
          key={`${vehicle.provider}:${vehicle.vehicle_id ?? `${vehicle.lat}:${vehicle.lng}`}`}
          selection={selectedVehicle}
          onClose={onClearSelection}
          onLocate={onLocate}
        />
      </>
    );
  } else if (selectedParking) {
    content = (
      <>
        {issue && <CardIssue issue={issue} onRetry={onRetry} />}
        <ParkingCard key={selectedParking.parking.id} selection={selectedParking} onClose={onClearSelection} />
      </>
    );
  } else if (dock.kind === 'outOfDate') {
    content = (
      <div className="dock-card">
        <StateHead
          icon="clock"
          tone="warning"
          title={text(dock.title)}
          body={dock.body.map(text).join(' ')}
          alert
        />
        <div className="card-actions">
          <RetryButton className="card-action-primary" busy={dock.busy} onRetry={onRetry}>
            <Icon name="refresh" size={18} />
            {text(dock.action)}
          </RetryButton>
        </div>
      </div>
    );
  } else if (dock.kind === 'outsideCoverage') {
    content = (
      <div className="dock-card">
        <StateHead icon="map" tone="info" title={text(dock.title)} body={text(dock.body)} />
        {dock.cities.length > 0 && (
          <>
            <p className="state-label" id="closest-cities">{text(dock.label)}</p>
            <div className="city-chips" role="group" aria-labelledby="closest-cities">
              {dock.cities.map((entry) => (
                <button
                  type="button"
                  key={entry.city.id}
                  className="chip"
                  onClick={tap(() => onCitySelect(entry.city))}
                >
                  <Icon name="pin" size={15} />
                  {formatCoverageCity(entry, i18n)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  } else if (dock.kind === 'filtersHideAll') {
    content = (
      <div className="dock-card">
        <StateHead
          icon="filters"
          tone="info"
          title={text(dock.title)}
          body={formatFilterSummary(dock.summary, i18n)}
        />
        <div className="card-actions">
          <button type="button" className="card-action-primary" onClick={tap(onResetFilters)}>
            {/* "Show all 1" reads badly; one hidden scooter gets the plain label. */}
            {dock.hiddenCount === 1 ? t('hidden.showAll') : text(dock.showAll)}
          </button>
          <button type="button" onClick={tap(onEditFilters)}>
            {text(dock.edit)}
          </button>
        </div>
      </div>
    );
  } else {
    const urgent = dock.status?.kind === 'failure';
    content = (
      <>
        <div className="sheet-title-row">
          <div className="dock-summary">
            <div className="sheet-count" aria-live="polite" aria-atomic="true">
              {dock.count.value === null ? (
                <>
                  {dock.phase === 'finding' && <span className="mini-spinner" aria-hidden="true" />}
                  {text(dock.count.label)}
                </>
              ) : (
                <>
                  <span key={dock.count.value} className="sheet-count-num">
                    {formatNumber(dock.count.value)}
                  </span>
                  {text(dock.count.label)}
                </>
              )}
            </div>
            {dock.status && !urgent && <StatusText status={dock.status} />}
            {/* Stays mounted, so that a failure is announced when it appears. */}
            <div role="status">{dock.status && urgent && <StatusText status={dock.status} />}</div>
          </div>
          {dock.retry && (
            <RetryButton className="dock-retry" busy={dock.busy} onRetry={onRetry}>
              {t('dock.tryAgain')}
            </RetryButton>
          )}
        </div>

        {dock.notices.length > 0 && (
          <div className="dock-notes" role="status">
            {dock.notices.map((notice) => (
              <p key={notice.kind} className="dock-note">
                <Icon name="warning" size={13} strokeWidth={2.2} />
                <span>{text(notice.text)}</span>
              </p>
            ))}
          </div>
        )}

        {dock.chips && (
          <ProviderChips chips={dock.chips} onShowAll={onShowAllProviders} onToggle={onProviderToggle} />
        )}

        {dock.hint && (
          <p className="dock-note dock-hint" role={dock.hint.kind === 'empty' ? 'status' : undefined}>
            <Icon name="pin" size={15} />
            <span>{text(dock.hint.text)}</span>
          </p>
        )}
      </>
    );
  }

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
        {content}
      </div>
    </div>
  );
}
