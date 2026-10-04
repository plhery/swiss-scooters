/** From the centre of a marker to the edge of its card: the marker, its selection ring and the arrow. */
export const POPOVER_GAP = 31;
/** What stays free between the card and the edges of the window. */
export const POPOVER_MARGIN = 16;
/** The arrow sits level with the head of the card when nothing is in the way. */
const ARROW_TOP = 59;
/** The arrow stays on the straight part of the edge, clear of the rounded corners. */
const ARROW_INSET = 32;

interface Size {
  width: number;
  height: number;
}

export interface PopoverPlacement {
  /** The side of the marker the card is on; the arrow is on the opposite edge of the card. */
  side: 'right' | 'left';
  left: number;
  top: number;
  /** The centre of the arrow, from the top of the card. */
  arrowTop: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Where the card of a selected scooter or parking bay goes on a desktop: to the
 * right of its marker, to the left where the right has no room, and moved up or
 * down to stay inside the window. The arrow keeps pointing at the marker.
 */
export function placePopover({ anchor, size, viewport, avoid = null }: {
  /** The centre of the marker. */
  anchor: { x: number; y: number };
  size: Size;
  viewport: Size;
  /** The search bar in the top left corner: a card that reaches under it starts below it. */
  avoid?: { right: number; bottom: number } | null;
}): PopoverPlacement {
  const fitsRight = anchor.x + POPOVER_GAP + size.width <= viewport.width - POPOVER_MARGIN;
  const fitsLeft = anchor.x - POPOVER_GAP - size.width >= POPOVER_MARGIN;
  const side = fitsRight || !fitsLeft ? 'right' : 'left';
  const beside = side === 'right' ? anchor.x + POPOVER_GAP : anchor.x - POPOVER_GAP - size.width;
  // A window too narrow for either side keeps the whole card in view, over the marker if it must.
  const left = clamp(beside, POPOVER_MARGIN, Math.max(POPOVER_MARGIN, viewport.width - POPOVER_MARGIN - size.width));

  const minTop = avoid && left < avoid.right ? Math.max(POPOVER_MARGIN, avoid.bottom) : POPOVER_MARGIN;
  const maxTop = Math.max(minTop, viewport.height - POPOVER_MARGIN - size.height);
  const top = clamp(anchor.y - ARROW_TOP, minTop, maxTop);
  const arrowTop = clamp(anchor.y - top, ARROW_INSET, Math.max(ARROW_INSET, size.height - ARROW_INSET));

  return { side, left, top, arrowTop };
}
