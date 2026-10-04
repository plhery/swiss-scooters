/** A rectangle on screen, as getBoundingClientRect() gives it. */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The room kept between a marker and what it has to stay clear of. */
export const REVEAL_GAP = 8;

/**
 * How far up, in pixels, the map has to move so that a marker is not hidden by
 * what floats over the lower part of the map: the dock, and the controls that
 * sit on it. 0 when the marker is in the clear or was not on screen to begin
 * with. Where the room above is short, the marker goes as far as it can.
 */
export function revealShift({ marker, obstacles, ceiling, floor, gap = REVEAL_GAP }: {
  marker: ScreenBox;
  /** The dock and the controls just above it. */
  obstacles: readonly ScreenBox[];
  /** The bottom of what lies over the top of the map; the marker is not pushed under it. */
  ceiling: number;
  /** The bottom of the map. */
  floor: number;
  gap?: number;
}): number {
  if (marker.top >= floor || marker.bottom <= ceiling) return 0;
  let shift = 0;
  // From the lowest up: getting clear of one may put the marker under the next.
  for (const box of [...obstacles].sort((a, b) => b.top - a.top)) {
    const beside = marker.right <= box.left || marker.left >= box.right;
    const top = marker.top - shift;
    const bottom = marker.bottom - shift;
    if (beside || bottom + gap <= box.top || top >= box.bottom) continue;
    shift += bottom + gap - box.top;
  }
  return Math.round(Math.max(0, Math.min(shift, marker.top - gap - ceiling)));
}
