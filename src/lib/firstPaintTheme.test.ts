// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseClientParams, parseStoredClientParams } from '@/lib/clientParams';
import { FIRST_PAINT_THEME_SCRIPT } from '@/lib/firstPaintTheme';

/** The appearance the page has before the app starts, for a link and what is saved on the device. */
function firstPaint(search: string, saved: string | null): string | null {
  window.history.replaceState(null, '', `/${search}`);
  if (saved === null) localStorage.removeItem('scooters-params');
  else localStorage.setItem('scooters-params', saved);
  document.body.innerHTML = '<div class="app-shell" data-theme="auto"></div>';
  new Function(FIRST_PAINT_THEME_SCRIPT)();
  return document.querySelector('.app-shell')!.getAttribute('data-theme');
}

/** The appearance the app arrives at once it has started, as readUrlParams() in the page works it out. */
function onceStarted(search: string, saved: string | null): string {
  const link = new URLSearchParams(search);
  const params = link.toString() ? parseClientParams(link) : parseStoredClientParams(saved);
  return params?.theme ?? 'auto';
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

describe('the appearance before the first paint', () => {
  it('is the one chosen on this device', () => {
    expect(firstPaint('', JSON.stringify({ theme: 'dark' }))).toBe('dark');
    expect(firstPaint('', JSON.stringify({ theme: 'light', map: 'detailed' }))).toBe('light');
  });

  it('is left to the system while nothing is chosen', () => {
    expect(firstPaint('', null)).toBe('auto');
    expect(firstPaint('', JSON.stringify({ minBattery: '60' }))).toBe('auto');
    expect(firstPaint('', JSON.stringify({ theme: 'auto' }))).toBe('auto');
  });

  it('follows the link before what is saved, as the app does', () => {
    expect(firstPaint('?theme=light', JSON.stringify({ theme: 'dark' }))).toBe('light');
    // A link with parameters but without an appearance means Automatic, whatever is saved.
    expect(firstPaint('?minBattery=60', JSON.stringify({ theme: 'dark' }))).toBe('auto');
  });

  it('carries the dark map style of old links and settings over', () => {
    expect(firstPaint('?tile=dark', null)).toBe('dark');
    expect(firstPaint('', JSON.stringify({ tile: 'dark' }))).toBe('dark');
    expect(firstPaint('?tile=osm', null)).toBe('auto');
  });

  it('does nothing with what it cannot read, and on a page without the app', () => {
    expect(firstPaint('?theme=neon', null)).toBe('auto');
    expect(firstPaint('', '{not json')).toBe('auto');
    expect(firstPaint('', '"dark"')).toBe('auto');
    expect(firstPaint('', JSON.stringify({ theme: 7 }))).toBe('auto');
    document.body.innerHTML = '<main class="legal-page"></main>';
    expect(() => new Function(FIRST_PAINT_THEME_SCRIPT)()).not.toThrow();
  });

  it.each([
    ['', null],
    ['', JSON.stringify({ theme: 'dark' })],
    ['', JSON.stringify({ theme: 'light', tile: 'dark' })],
    ['', JSON.stringify({ tile: 'dark', map: 'detailed' })],
    ['', JSON.stringify({ tile: 'light' })],
    ['', JSON.stringify(['dark'])],
    ['?theme=dark', null],
    ['?theme=auto&tile=dark', null],
    ['?theme=neon&tile=dark', JSON.stringify({ theme: 'light' })],
    ['?origin=47.3769,8.5417', JSON.stringify({ theme: 'dark' })],
    ['?map=detailed', JSON.stringify({ theme: 'light' })],
  ])('is what the app arrives at once it has started: link "%s", saved %s', (search, saved) => {
    expect(firstPaint(search, saved)).toBe(onceStarted(search, saved));
  });
});
