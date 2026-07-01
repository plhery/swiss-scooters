'use client';

interface MapControlsProps {
  loading: boolean;
  onLocateMe: () => void;
  onRefresh: () => void;
}

export default function MapControls({ loading, onLocateMe, onRefresh }: MapControlsProps) {
  return (
    <div className="fab-stack">
      <button className="fab glass" onClick={onLocateMe} aria-label="Go to my location">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M21.7 2.3a1 1 0 0 1 .2 1.1l-8 18a1 1 0 0 1-1.9-.1l-2.2-6.6a1 1 0 0 0-.6-.6L2.7 12a1 1 0 0 1-.1-1.9l18-8a1 1 0 0 1 1.1.2Z" />
        </svg>
      </button>
      <button className="fab glass" onClick={onRefresh} disabled={loading} aria-label="Refresh scooters">
        <svg
          className={loading ? 'spin' : undefined}
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v5h-5" />
        </svg>
      </button>
    </div>
  );
}
