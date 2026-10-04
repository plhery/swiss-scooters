import { describe, expect, it } from 'vitest';
import { placePopover } from '@/lib/popoverPlacement';

const viewport = { width: 1440, height: 900 };
const size = { width: 320, height: 231 };

describe('placePopover', () => {
  it('opens to the right of the marker with the arrow level with the head of the card', () => {
    // The marker and the card of the X-Desktop-card artboard.
    expect(placePopover({ anchor: { x: 903, y: 392 }, size, viewport })).toEqual({
      side: 'right', left: 934, top: 333, arrowTop: 59,
    });
  });

  it('flips to the left where the right has no room', () => {
    const placement = placePopover({ anchor: { x: 1300, y: 392 }, size, viewport });

    expect(placement).toMatchObject({ side: 'left', left: 1300 - 31 - 320, top: 333, arrowTop: 59 });
  });

  it('stays on the right while the card still fits before the edge', () => {
    // 1440 - 16 - 320 - 31 = 1073 is the last marker position with room on the right.
    expect(placePopover({ anchor: { x: 1073, y: 392 }, size, viewport }).side).toBe('right');
    expect(placePopover({ anchor: { x: 1074, y: 392 }, size, viewport }).side).toBe('left');
  });

  it('moves down under the top edge and keeps the arrow on the marker', () => {
    const placement = placePopover({ anchor: { x: 600, y: 50 }, size, viewport });

    expect(placement.top).toBe(16);
    expect(placement.arrowTop).toBe(34);
  });

  it('moves up above the bottom edge and keeps the arrow on the marker', () => {
    const placement = placePopover({ anchor: { x: 600, y: 840 }, size, viewport });

    expect(placement.top).toBe(900 - 16 - 231);
    expect(placement.top + placement.arrowTop).toBe(840);
  });

  it('keeps the arrow off the rounded corners when the marker is beyond the card', () => {
    expect(placePopover({ anchor: { x: 600, y: 20 }, size, viewport }).arrowTop).toBe(32);
    expect(placePopover({ anchor: { x: 600, y: 895 }, size, viewport }).arrowTop).toBe(231 - 32);
  });

  it('starts below the search bar when the card reaches under it', () => {
    const narrow = { width: 900, height: 700 };
    const avoid = { right: 416, bottom: 98 };

    // No room on the right: the card flips and its left edge is under the search bar.
    const under = placePopover({ anchor: { x: 700, y: 60 }, size, viewport: narrow, avoid });
    expect(under).toMatchObject({ side: 'left', left: 349, top: 98 });
    expect(under.arrowTop).toBe(32);

    // Beside the search bar there is nothing to avoid.
    const beside = placePopover({ anchor: { x: 450, y: 60 }, size, viewport: narrow, avoid });
    expect(beside).toMatchObject({ side: 'right', left: 481, top: 16 });
  });

  it('keeps the whole card in a window too narrow for either side', () => {
    const placement = placePopover({ anchor: { x: 300, y: 300 }, size, viewport: { width: 600, height: 600 } });

    expect(placement.side).toBe('right');
    expect(placement.left).toBe(600 - 16 - 320);
  });

  it('stays at the top of a window shorter than the card', () => {
    const placement = placePopover({ anchor: { x: 200, y: 150 }, size, viewport: { width: 1000, height: 200 } });

    expect(placement.top).toBe(16);
  });
});
