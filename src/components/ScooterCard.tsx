'use client';

import type { CSSProperties } from 'react';
import { track } from '@/lib/analytics';
import { batteryLevel } from '@/lib/battery';
import { selectionFeedback } from '@/lib/feedback';
import { useI18n } from '@/lib/i18n';
import { browserRentalLink } from '@/lib/rentalLinks';
import { RIDE_DURATIONS, formatRidePrice, ridePriceQuote } from '@/lib/ridePrice';
import { PROVIDERS, type Vehicle } from '@/lib/types';
import { useRideDuration } from '@/lib/useRideDuration';
import { formatDistance, walkingDirectionsUrl, walkingMinutes, type WalkEstimate } from '@/lib/walking';
import Icon from './Icon';

export interface SelectedVehicle {
  vehicle: Vehicle;
  /** Null without an origin: neither your location nor a searched place. */
  walk: WalkEstimate | null;
}

interface ScooterCardProps {
  selection: SelectedVehicle;
  onClose: () => void;
  /** Starts locating, from the line that stands in for the walking time. */
  onLocate: () => void;
}

/** What the dock shows for the selected scooter: who runs it, how far it is, what a ride costs. */
export default function ScooterCard({ selection, onClose, onLocate }: ScooterCardProps) {
  const i18n = useI18n();
  const { locale, t, formatNumber } = i18n;
  const [duration, setDuration] = useRideDuration();
  const { vehicle, walk } = selection;
  const provider = PROVIDERS[vehicle.provider];
  const name = provider?.name ?? vehicle.provider;
  const rentalLink = browserRentalLink(
    vehicle,
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
    typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints
  );
  const quote = vehicle.pricing ? ridePriceQuote(vehicle.pricing, duration) : null;

  return (
    <div className="dock-card">
      <div className="card-head">
        <span
          className="card-symbol"
          style={{ '--provider-color': provider?.color ?? '#8e8e93' } as CSSProperties}
        >
          <Icon name="scooter" size={26} />
        </span>
        <div className="card-title">
          <h2>{name}</h2>
          {walk ? (
            <p>
              {t(walk.place ? 'card.walkFrom' : 'card.walk', {
                minutes: formatNumber(walkingMinutes(walk.distanceM)),
                distance: formatDistance(walk.distanceM, i18n),
                ...(walk.place ? { place: walk.place } : {}),
              })}
            </p>
          ) : (
            <button
              type="button"
              className="card-link"
              onClick={() => {
                selectionFeedback();
                onLocate();
              }}
            >
              {t('card.noOrigin')}
            </button>
          )}
        </div>
        <button
          type="button"
          className="card-close"
          onClick={() => {
            selectionFeedback();
            onClose();
          }}
          aria-label={t('card.close')}
        >
          <Icon name="close" size={17} />
        </button>
      </div>

      <div className="card-pills">
        {vehicle.battery !== null && (
          <span className={`pill pill-${batteryLevel(vehicle.battery)}`}>
            <Icon name="battery" size={15} />
            {formatNumber(vehicle.battery)}%
          </span>
        )}
        {vehicle.range_m !== null && (
          <span className="pill">
            <Icon name="range" size={14} />
            {formatDistance(vehicle.range_m, i18n)}
          </span>
        )}
        {quote ? (
          // A native select under the pill: the system's own picker on a phone, a menu on a desktop.
          <span className="pill pill-choice">
            <span>
              {t('card.price', {
                price: formatRidePrice(quote.totalMinorUnits, quote.currency, locale),
                minutes: formatNumber(duration),
              })}
            </span>
            <Icon name="upDown" size={12} strokeWidth={2.4} />
            <select
              aria-label={t('card.priceAria', { minutes: formatNumber(duration) })}
              value={duration}
              onChange={(event) => {
                selectionFeedback();
                setDuration(Number(event.target.value));
              }}
            >
              {RIDE_DURATIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {t('card.duration', { minutes: formatNumber(minutes) })}
                </option>
              ))}
            </select>
          </span>
        ) : (
          <span className="pill">{t('card.priceInApp', { name })}</span>
        )}
      </div>

      <div className="card-actions">
        <a
          href={walkingDirectionsUrl(vehicle.lat, vehicle.lng)}
          target="_blank"
          rel="noreferrer"
          onClick={() => { track('directions_open', { provider: vehicle.provider, target: 'vehicle' }); selectionFeedback(); }}
        >
          <Icon name="walk" size={18} />
          {t('card.directions')}
        </a>
        {rentalLink && (
          <a
            className="card-action-primary"
            href={rentalLink}
            target="_blank"
            rel="noreferrer"
            onClick={() => { track('rental_open', { provider: vehicle.provider }); selectionFeedback(); }}
          >
            <Icon name="scooter" size={18} />
            {t('card.openIn', { name })}
          </a>
        )}
      </div>
      <p className="card-footnote">{t(rentalLink ? 'card.footnote' : 'card.noLink', { name })}</p>
    </div>
  );
}
