'use client';

import { useLayoutEffect, useRef } from 'react';
import { selectionFeedback } from '@/lib/feedback';
import { useI18n } from '@/lib/i18n';
import { failureReasonKey, type LoadFailure } from '@/lib/loadFailure';
import type { LiveLocationError } from '@/lib/useLiveLocation';
import Icon from './Icon';

interface MapNoticesProps {
  /** Why scooters could not be loaded; null when there is nothing to say. */
  loadFailure: LoadFailure | null;
  /** A request for scooters is running. */
  loading: boolean;
  /** Why the last attempt to locate failed; null once it is dismissed or retried. */
  locationError: LiveLocationError | null;
  hidden: boolean;
  onRetryLoad: () => void;
  onRetryLocate: () => void;
  onSearchPlace: () => void;
  onDismissLocation: () => void;
}

/** What went wrong, under the search bar: scooters that did not load, a location that is off or not found. */
export default function MapNotices({
  loadFailure,
  loading,
  locationError,
  hidden,
  onRetryLoad,
  onRetryLocate,
  onSearchPlace,
  onDismissLocation,
}: MapNoticesProps) {
  const { t } = useI18n();
  const stackRef = useRef<HTMLDivElement>(null);
  const tap = (action: () => void) => () => { selectionFeedback(); action(); };

  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    // The compass and zoom buttons share this corner on narrow screens; they
    // move down by the height of whatever is shown here.
    const update = () => {
      const height = Math.ceil(stack.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--notices-h', height > 0 ? `${height + 8}px` : '0px');
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stack);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--notices-h');
    };
  }, []);

  return (
    <div ref={stackRef} className="map-notices" inert={hidden} aria-hidden={hidden}>
      {loadFailure && (
        <div className="load-banner glass" role="alert">
          <Icon name="warning" size={17} strokeWidth={2.2} />
          <span>{t(failureReasonKey(loadFailure))}</span>
          <button type="button" aria-busy={loading} onClick={tap(onRetryLoad)}>
            {t('dock.tryAgain')}
          </button>
        </div>
      )}
      {locationError && (
        <div className="location-card glass" role="status">
          <span className="location-card-symbol">
            <Icon name="locationOff" size={19} />
          </span>
          <div className="location-card-copy">
            {locationError === 'denied' ? (
              <>
                <strong>{t('loc.off.title')}</strong>
                <p>{t('loc.off.body')}</p>
              </>
            ) : (
              <strong>{t('loc.notFound')}</strong>
            )}
            <div className="location-card-actions">
              {locationError === 'denied' ? (
                <button type="button" onClick={tap(onSearchPlace)}>{t('loc.searchPlace')}</button>
              ) : (
                <button type="button" onClick={tap(onRetryLocate)}>{t('loc.tryAgain')}</button>
              )}
            </div>
          </div>
          <button
            type="button"
            className="location-card-close"
            onClick={tap(onDismissLocation)}
            aria-label={t('loc.dismiss')}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
