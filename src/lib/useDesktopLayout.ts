import { useSyncExternalStore } from 'react';

/**
 * A wide window with a mouse or trackpad. There the dock is a legend under the
 * search bar and a card opens beside its marker; phones and tablets keep the
 * dock at the bottom. The stylesheet asks the same question for the layout.
 */
export const DESKTOP_LAYOUT_QUERY = '(min-width: 900px) and (pointer: fine)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia?.(DESKTOP_LAYOUT_QUERY);
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}

function matches(): boolean {
  return Boolean(window.matchMedia?.(DESKTOP_LAYOUT_QUERY)?.matches);
}

/** False on the server and until the page has hydrated, so the first render is the phone's. */
export function useDesktopLayout(): boolean {
  return useSyncExternalStore(subscribe, matches, () => false);
}
