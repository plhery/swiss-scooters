'use client';

import { useLayoutEffect, type ReactNode, type RefObject } from 'react';
import type L from 'leaflet';
import { placePopover } from '@/lib/popoverPlacement';

// What stays free between the card and the search bar when the card is below it.
const SEARCH_BAR_GAP = 12;

/**
 * Keeps a card beside its marker while the map moves, zooms, rotates or is
 * resized, and while the card itself changes size. Returns what stops it.
 */
export function followMarker(map: L.Map, card: HTMLElement, anchor: () => HTMLElement | null): () => void {
  let frame = 0;

  const update = () => {
    const marker = anchor();
    if (!marker) {
      delete card.dataset.placed;
      return;
    }
    // Read from the marker as it is drawn: that also holds halfway through a zoom animation.
    const target = marker.getBoundingClientRect();
    const area = map.getContainer().getBoundingClientRect();
    const bar = document.querySelector('.search-island')?.getBoundingClientRect();
    const placement = placePopover({
      anchor: { x: target.left + target.width / 2 - area.left, y: target.top + target.height / 2 - area.top },
      size: { width: card.offsetWidth, height: card.offsetHeight },
      viewport: { width: area.width, height: area.height },
      avoid: bar && { right: bar.right - area.left + SEARCH_BAR_GAP, bottom: bar.bottom - area.top + SEARCH_BAR_GAP },
    });
    card.style.left = `${Math.round(area.left + placement.left)}px`;
    card.style.top = `${Math.round(area.top + placement.top)}px`;
    card.style.setProperty('--arrow-top', `${Math.round(placement.arrowTop)}px`);
    card.dataset.side = placement.side;
    card.dataset.placed = 'true';
  };

  // Leaflet moves the markers with a CSS transition while it zooms and reports
  // the new view only at the end: until then the card follows frame by frame.
  const follow = () => {
    update();
    frame = requestAnimationFrame(follow);
  };
  const startFollowing = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(follow);
  };
  const stopFollowing = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    update();
  };

  update();
  map.on('move zoom rotate resize', update);
  map.on('zoomanim', startFollowing);
  map.on('zoomend', stopFollowing);
  const observer = new ResizeObserver(update);
  observer.observe(card);

  return () => {
    cancelAnimationFrame(frame);
    map.off('move zoom rotate resize', update);
    map.off('zoomanim', startFollowing);
    map.off('zoomend', stopFollowing);
    observer.disconnect();
  };
}

interface MarkerPopoverProps {
  /** The card itself; followMarker() positions it. */
  cardRef: RefObject<HTMLDivElement | null>;
  /** Names the dialog: "Lime scooter", "Dott parking bay". */
  label: string;
  /** Changes with the scooter or bay shown. */
  selectionKey: string;
  /** The marker the card belongs to; it gets the focus back when the card closes. */
  anchor: () => HTMLElement | null;
  children: ReactNode;
}

/**
 * The card of a selected scooter or parking bay on a desktop: beside its marker
 * with a small arrow, while the dock keeps the count and the providers.
 */
export default function MarkerPopover({ cardRef, label, selectionKey, anchor, children }: MarkerPopoverProps) {
  // The card is not next to its marker in the page, so the focus moves into it
  // when it opens, and back to the marker when it closes with the focus inside.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    card.focus({ preventScroll: true });
    return () => {
      if (card.contains(document.activeElement)) anchor()?.focus({ preventScroll: true });
    };
  }, [anchor, cardRef, selectionKey]);

  return (
    <div ref={cardRef} className="marker-popover glass" role="dialog" aria-label={label} tabIndex={-1}>
      <span className="marker-popover-arrow" aria-hidden="true" />
      {children}
    </div>
  );
}
