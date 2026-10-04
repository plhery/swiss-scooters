'use client';

import { useI18n } from '@/lib/i18n';
import { selectionFeedback } from '@/lib/feedback';

interface MapControlsProps {
  locating?: boolean;
  /** This device has located successfully before. Null until that is known. */
  locatedOnce: boolean | null;
  hidden: boolean;
  onLocateMe: () => void;
}

export default function MapControls({
  locating = false,
  locatedOnce,
  hidden,
  onLocateMe,
}: MapControlsProps) {
  const { t } = useI18n();

  return (
    <div className="fab-stack" inert={hidden} aria-hidden={hidden}>
      <span className="sr-only" role="status">
        {locating ? t('bar.locating') : ''}
      </span>
      {/* Until the first successful fix the button says what it does; after that the icon is enough. */}
      {locatedOnce !== null && (
        <button
          type="button"
          className={locatedOnce ? 'fab glass' : 'near-me'}
          disabled={locating}
          onClick={() => { selectionFeedback(); onLocateMe(); }}
          aria-label={locatedOnce ? t('controls.locate') : undefined}
        >
          {locating ? <span className="mini-spinner" aria-hidden="true" /> : <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M21.7 2.3a1 1 0 0 1 .2 1.1l-8 18a1 1 0 0 1-1.9-.1l-2.2-6.6a1 1 0 0 0-.6-.6L2.7 12a1 1 0 0 1-.1-1.9l18-8a1 1 0 0 1 1.1.2Z" />
          </svg>}
          {!locatedOnce && <span>{t('loc.nearMe')}</span>}
        </button>
      )}
    </div>
  );
}
