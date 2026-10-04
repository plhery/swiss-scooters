// @vitest-environment jsdom

import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import type L from 'leaflet';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MarkerPopover, { followMarker } from '@/components/MarkerPopover';

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** An element that reports the given box, as a laid-out one would. */
function box(tag: string, at: () => DOMRect, size?: { width: number; height: number }) {
  const element = document.body.appendChild(document.createElement(tag));
  element.getBoundingClientRect = at;
  if (size) {
    Object.defineProperty(element, 'offsetWidth', { value: size.width });
    Object.defineProperty(element, 'offsetHeight', { value: size.height });
  }
  return element;
}

/** As much of a Leaflet map as followMarker() uses: a container and events. */
function fakeMap(width = 1440, height = 900) {
  const handlers = new Map<string, Set<() => void>>();
  const each = (types: string, run: (type: string) => void) => types.split(' ').forEach(run);
  const map = {
    getContainer: () => container,
    on: (types: string, handler: () => void) => each(types, type => {
      handlers.set(type, (handlers.get(type) ?? new Set()).add(handler));
    }),
    off: (types: string, handler: () => void) => each(types, type => handlers.get(type)?.delete(handler)),
  };
  const container = box('div', () => rect(0, 0, width, height));
  return {
    map: map as unknown as L.Map,
    fire: (type: string) => handlers.get(type)?.forEach(handler => handler()),
    listeners: () => [...handlers.values()].reduce((total, set) => total + set.size, 0),
  };
}

let observed: Element[] = [];
let frames: FrameRequestCallback[] = [];
beforeEach(() => {
  document.body.replaceChildren();
  observed = [];
  frames = [];
  vi.stubGlobal('ResizeObserver', class {
    observe(element: Element) { observed.push(element); }
    disconnect() { observed = []; }
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames[id - 1] = () => {}; });
});

describe('followMarker', () => {
  it('puts the card to the right of its marker, with the arrow level with the marker', () => {
    const { map } = fakeMap();
    const card = box('div', () => rect(0, 0, 320, 231), { width: 320, height: 231 });
    // A 44 px marker whose centre is at 903, 392: the X-Desktop-card artboard.
    const marker = box('div', () => rect(881, 370, 44, 44));

    followMarker(map, card, () => marker);

    expect(card.style.left).toBe('934px');
    expect(card.style.top).toBe('333px');
    expect(card.style.getPropertyValue('--arrow-top')).toBe('59px');
    expect(card.dataset.side).toBe('right');
    expect(card.dataset.placed).toBe('true');
    expect(observed).toEqual([card]);
  });

  it('follows the marker when the map moves, and flips where the right has no room', () => {
    const { map, fire } = fakeMap();
    const card = box('div', () => rect(0, 0, 320, 231), { width: 320, height: 231 });
    let x = 881;
    const marker = box('div', () => rect(x, 370, 44, 44));
    followMarker(map, card, () => marker);

    x = 1278;
    fire('move');

    expect(card.dataset.side).toBe('left');
    expect(card.style.left).toBe(`${1300 - 31 - 320}px`);
  });

  it('follows the marker frame by frame while the map zooms', () => {
    const { map, fire } = fakeMap();
    const card = box('div', () => rect(0, 0, 320, 231), { width: 320, height: 231 });
    let y = 370;
    const marker = box('div', () => rect(881, y, 44, 44));
    followMarker(map, card, () => marker);

    fire('zoomanim');
    y = 470;
    frames.at(-1)!(0);
    expect(card.style.top).toBe('433px');
    y = 570;
    frames.at(-1)!(16);
    expect(card.style.top).toBe('533px');

    const requested = frames.length;
    fire('zoomend');
    frames.at(-1)!(32);
    expect(frames).toHaveLength(requested);
  });

  it('starts below the search bar when the card would reach under it', () => {
    const { map } = fakeMap(900, 700);
    const bar = box('div', () => rect(24, 24, 380, 62));
    bar.className = 'search-island';
    const card = box('div', () => rect(0, 0, 320, 231), { width: 320, height: 231 });
    const marker = box('div', () => rect(678, 38, 44, 44));

    followMarker(map, card, () => marker);

    expect(card.dataset.side).toBe('left');
    expect(card.style.top).toBe('98px');
  });

  it('keeps the card out of view while its marker is not on the map', () => {
    const { map, fire } = fakeMap();
    const card = box('div', () => rect(0, 0, 320, 231), { width: 320, height: 231 });
    let marker: HTMLElement | null = null;
    followMarker(map, card, () => marker);
    expect(card.dataset.placed).toBeUndefined();

    marker = box('div', () => rect(881, 370, 44, 44));
    fire('move');
    expect(card.dataset.placed).toBe('true');

    marker = null;
    fire('move');
    expect(card.dataset.placed).toBeUndefined();
  });

  it('stops following when it is told to', () => {
    const { map, fire, listeners } = fakeMap();
    const card = box('div', () => rect(0, 0, 320, 231), { width: 320, height: 231 });
    let x = 881;
    const marker = box('div', () => rect(x, 370, 44, 44));
    const stop = followMarker(map, card, () => marker);
    expect(listeners()).toBeGreaterThan(0);

    stop();
    x = 400;
    fire('move');

    expect(listeners()).toBe(0);
    expect(observed).toEqual([]);
    expect(card.style.left).toBe('934px');
  });
});

describe('MarkerPopover', () => {
  function setup() {
    const marker = document.body.appendChild(document.createElement('button'));
    const other = document.body.appendChild(document.createElement('button'));
    const cardRef = createRef<HTMLDivElement>();
    const anchor = () => marker;
    const popover = (selectionKey: string) => (
      <MarkerPopover cardRef={cardRef} label="Lime scooter" selectionKey={selectionKey} anchor={anchor}>
        <button type="button">Close scooter details</button>
      </MarkerPopover>
    );
    return { marker, other, popover };
  }

  it('is a dialog named after what it shows, and takes the focus when it opens', () => {
    const { marker, popover } = setup();
    marker.focus();

    render(popover('lime:1'));

    const card = screen.getByRole('dialog', { name: 'Lime scooter' });
    expect(card).toHaveFocus();
    expect(card.querySelector('.marker-popover-arrow')).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives the focus back to the marker when it closes with the focus inside', () => {
    const { marker, popover } = setup();
    const view = render(popover('lime:1'));
    screen.getByRole('button', { name: 'Close scooter details' }).focus();

    view.unmount();

    expect(marker).toHaveFocus();
  });

  it('leaves the focus where it is when it closes while the focus is elsewhere', () => {
    const { other, popover } = setup();
    const view = render(popover('lime:1'));
    other.focus();

    view.unmount();

    expect(other).toHaveFocus();
  });

  it('takes the focus again when another scooter is selected', () => {
    const { other, popover } = setup();
    const view = render(popover('lime:1'));
    // A click on another marker moves the focus there first.
    other.focus();

    view.rerender(popover('bird:1'));

    expect(screen.getByRole('dialog')).toHaveFocus();
  });
});
