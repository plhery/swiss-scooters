'use client';

import { useSyncExternalStore } from 'react';
const subscribe = (update: () => void) => {
  window.addEventListener('storage', update);
  window.addEventListener('analytics-preference', update);
  return () => {
    window.removeEventListener('storage', update);
    window.removeEventListener('analytics-preference', update);
  };
};
const snapshot = () => {
  try { return !localStorage.getItem('umami.disabled'); } catch { return false; }
};

export default function AnalyticsPreference() {
  const enabled = useSyncExternalStore(subscribe, snapshot, () => false);
  return (
    <label>
      <input type="checkbox" checked={enabled} onChange={event => {
        try {
          if (event.target.checked) localStorage.removeItem('umami.disabled');
          else localStorage.setItem('umami.disabled', '1');
          window.dispatchEvent(new Event('analytics-preference'));
        } catch { /* Storage may be blocked by browser privacy settings. */ }
      }} />{' '}Share anonymous usage on this browser
    </label>
  );
}
