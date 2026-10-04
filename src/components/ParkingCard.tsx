'use client';

import type { CSSProperties } from 'react';
import { track } from '@/lib/analytics';
import { selectionFeedback } from '@/lib/feedback';
import { useI18n } from '@/lib/i18n';
import { PROVIDERS, type ParkingLocation } from '@/lib/types';
import { walkingDirectionsUrl, walkingMinutes, type WalkEstimate } from '@/lib/walking';
import Icon from './Icon';

export interface SelectedParking {
  parking: ParkingLocation;
  /** Null without an origin: neither your location nor a searched place. */
  walk: WalkEstimate | null;
}

interface ParkingCardProps {
  selection: SelectedParking;
  onClose: () => void;
}

/** What the dock shows for the selected parking bay: whose it is, where it is, and whether parking there is required. */
export default function ParkingCard({ selection, onClose }: ParkingCardProps) {
  const { t, formatNumber } = useI18n();
  const { parking, walk } = selection;
  const provider = PROVIDERS[parking.provider];
  const name = provider?.name ?? parking.provider;
  const walkLine = walk && t(walk.place ? 'bay.walkFrom' : 'bay.walk', {
    minutes: formatNumber(walkingMinutes(walk.distanceM)),
    ...(walk.place ? { place: walk.place } : {}),
  });
  // A feed may leave the name of the bay out.
  const place = parking.name.trim();

  return (
    <div className="dock-card">
      <div className="card-head">
        <span
          className="bay-symbol"
          style={{ '--provider-color': provider?.color ?? '#2166c2' } as CSSProperties}
          aria-hidden="true"
        >
          P
        </span>
        <div className="card-title">
          <h2>{t('bay.title', { name })}</h2>
          {(place || walkLine) && (
            <p>
              {place}
              {place && walkLine && ' · '}
              {walkLine && <span className="bay-walk">{walkLine}</span>}
            </p>
          )}
        </div>
        <button
          type="button"
          className="card-close"
          onClick={() => {
            selectionFeedback();
            onClose();
          }}
          aria-label={t('bay.close')}
        >
          <Icon name="close" size={17} />
        </button>
      </div>

      <p className={`bay-notice ${parking.mandatory ? 'bay-notice-required' : ''}`}>
        <Icon name="info" size={17} />
        <span>{t(parking.mandatory ? 'bay.required' : 'bay.designated')}</span>
      </p>

      <div className="card-actions">
        <a
          className="card-action-primary"
          href={walkingDirectionsUrl(parking.lat, parking.lng)}
          target="_blank"
          rel="noreferrer"
          onClick={() => { track('directions_open', { provider: parking.provider, target: 'parking' }); selectionFeedback(); }}
        >
          <Icon name="walk" size={18} />
          {t('card.directions')}
        </a>
      </div>
      <p className="card-footnote">{t('bay.check', { name })}</p>
    </div>
  );
}
