import { describe, expect, it } from 'vitest';
import { REVEAL_GAP, revealShift, type ScreenBox } from '@/lib/markerReveal';

// A phone of 390 by 844: the search bar ends at 72, the dock holds a card from 620 down.
const dock: ScreenBox = { left: 10, top: 620, right: 380, bottom: 834 };
const locate: ScreenBox = { left: 328, top: 556, right: 378, bottom: 606 };
const credits: ScreenBox = { left: 12, top: 582, right: 153, bottom: 614 };
const phone = { obstacles: [locate, dock, credits], ceiling: 72, floor: 844 };
const marker = (left: number, top: number): ScreenBox => ({ left, top, right: left + 44, bottom: top + 44 });

describe('revealShift', () => {
  it('leaves the map alone when the marker is clear of the dock and its controls', () => {
    expect(revealShift({ marker: marker(180, 300), ...phone })).toBe(0);
    // Just above the dock, between the credits and the locate button.
    expect(revealShift({ marker: marker(180, 620 - 44 - REVEAL_GAP), ...phone })).toBe(0);
  });

  it('moves a marker that the dock has grown over to just above it', () => {
    // Picked at 640, where the dock was not yet: the card now starts at 620.
    expect(revealShift({ marker: marker(180, 640), ...phone })).toBe(640 + 44 + REVEAL_GAP - 620);
    // The same for one that is only partly covered.
    expect(revealShift({ marker: marker(180, 600), ...phone })).toBe(600 + 44 + REVEAL_GAP - 620);
  });

  it('moves on above a control when getting clear of the dock would put the marker under it', () => {
    // At the right edge, the locate button is what is above the dock.
    expect(revealShift({ marker: marker(330, 640), ...phone })).toBe(640 + 44 + REVEAL_GAP - 556);
    // At the left edge, the credits.
    expect(revealShift({ marker: marker(60, 640), ...phone })).toBe(640 + 44 + REVEAL_GAP - 582);
    // A marker under a control alone is moved too.
    expect(revealShift({ marker: marker(330, 540), ...phone })).toBe(540 + 44 + REVEAL_GAP - 556);
  });

  it('does not count what is beside the marker', () => {
    // A phone on its side: the dock is a column in the middle, the marker is left of it.
    const column: ScreenBox = { left: 142, top: 171, right: 702, bottom: 378 };
    expect(revealShift({ marker: marker(60, 250), obstacles: [column], ceiling: 70, floor: 390 })).toBe(0);
    expect(revealShift({ marker: marker(300, 250), obstacles: [column], ceiling: 70, floor: 390 })).toBe(250 + 44 + REVEAL_GAP - 171);
  });

  it('stops under the search bar where the room above the dock is short', () => {
    // The card leaves 40 px under the bar, less than a marker: it goes as far up as the bar allows.
    const tall: ScreenBox = { left: 10, top: 112, right: 380, bottom: 378 };
    expect(revealShift({ marker: marker(180, 200), obstacles: [tall], ceiling: 72, floor: 390 })).toBe(200 - REVEAL_GAP - 72);
    // And stays where it is when it is already as high as it can be.
    expect(revealShift({ marker: marker(180, 76), obstacles: [tall], ceiling: 72, floor: 390 })).toBe(0);
  });

  it('leaves alone a marker that is not on screen', () => {
    expect(revealShift({ marker: marker(180, 900), ...phone })).toBe(0);
    expect(revealShift({ marker: marker(180, -60), ...phone })).toBe(0);
  });
});
