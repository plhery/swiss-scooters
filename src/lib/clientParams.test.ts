import { describe, expect, it } from 'vitest';
import {
  parseClientParams,
  parseStoredClientParams,
  serializeClientParams,
} from '@/lib/clientParams';

const parse = (query: string) => parseClientParams(new URLSearchParams(query));

describe('client params', () => {
  it('parses valid URL settings', () => {
    expect(parseClientParams(new URLSearchParams({
      origin: '47.3769,8.5417',
      minBattery: '30',
      theme: 'dark',
      map: 'detailed',
    }))).toEqual({
      origin: [47.3769, 8.5417],
      minBattery: 30,
      theme: 'dark',
      map: 'detailed',
    });
  });

  it('rejects out-of-range coordinates and malformed values', () => {
    expect(parseClientParams(new URLSearchParams({
      origin: '999,999',
      minBattery: 'abc',
      theme: 'sepia',
      map: 'satellite',
      tile: 'sepia',
    }))).toEqual({
      origin: null,
      minBattery: undefined,
      theme: undefined,
      map: undefined,
    });
  });

  it('leaves everything undefined when the URL says nothing', () => {
    expect(parse('')).toEqual({ origin: null, minBattery: undefined, theme: undefined, map: undefined });
    expect(parse('minBattery=')).toMatchObject({ minBattery: undefined });
  });

  it('snaps battery values down to the presets', () => {
    expect(parse('minBattery=0').minBattery).toBe(0);
    expect(parse('minBattery=60').minBattery).toBe(60);
    expect(parse('minBattery=45').minBattery).toBe(30);
    expect(parse('minBattery=95').minBattery).toBe(80);
    expect(parse('minBattery=103').minBattery).toBe(80);
    expect(parse('minBattery=25').minBattery).toBe(0);
    expect(parse('minBattery=-2').minBattery).toBe(0);
  });

  it('accepts each theme and map style by name', () => {
    expect(parse('theme=light')).toMatchObject({ theme: 'light', map: undefined });
    expect(parse('theme=auto')).toMatchObject({ theme: 'auto' });
    expect(parse('map=calm')).toMatchObject({ theme: undefined, map: 'calm' });
  });

  it('reads the old tile setting', () => {
    expect(parse('tile=dark')).toMatchObject({ theme: 'dark', map: undefined });
    expect(parse('tile=osm')).toMatchObject({ theme: undefined, map: 'detailed' });
    expect(parse('tile=light')).toMatchObject({ theme: undefined, map: undefined });
  });

  it('prefers the new settings over the old one', () => {
    expect(parse('tile=dark&theme=light')).toMatchObject({ theme: 'light', map: undefined });
    expect(parse('tile=osm&map=calm')).toMatchObject({ theme: undefined, map: 'calm' });
    expect(parse('tile=osm&theme=dark')).toMatchObject({ theme: 'dark', map: 'detailed' });
  });

  it('accepts only recognized string values from storage', () => {
    expect(parseStoredClientParams(JSON.stringify({
      origin: '47.4,8.5',
      minBattery: '60',
      theme: 'dark',
      map: 'detailed',
      extra: 'ignored',
    }))).toEqual({
      origin: null,
      minBattery: 60,
      theme: 'dark',
      map: 'detailed',
    });
    expect(parseStoredClientParams(JSON.stringify({ minBattery: 60, theme: ['dark'] }))).toBeNull();
    expect(parseStoredClientParams('["47.4,8.5"]')).toBeNull();
    expect(parseStoredClientParams('{bad json')).toBeNull();
    expect(parseStoredClientParams(null)).toBeNull();
  });

  it('restores settings stored by earlier releases', () => {
    expect(parseStoredClientParams(JSON.stringify({ minBattery: '50', tile: 'osm' })))
      .toEqual({ origin: null, minBattery: 30, theme: undefined, map: 'detailed' });
    expect(parseStoredClientParams(JSON.stringify({ tile: 'dark' })))
      .toEqual({ origin: null, minBattery: undefined, theme: 'dark', map: undefined });
    // The old default says nothing the new defaults do not.
    expect(parseStoredClientParams(JSON.stringify({ tile: 'light' }))).toBeNull();
  });

  it('serializes only non-default settings', () => {
    expect(serializeClientParams({ minBattery: 0, theme: 'auto', map: 'calm' }).toString()).toBe('');
    expect(serializeClientParams({ minBattery: 60, theme: 'dark', map: 'detailed' }).toString())
      .toBe('minBattery=60&theme=dark&map=detailed');
    expect(serializeClientParams({ minBattery: 0, theme: 'light', map: 'calm' }).toString()).toBe('theme=light');
  });

  it('never writes the old tile setting or an origin', () => {
    const written = serializeClientParams({ minBattery: 30, theme: 'dark', map: 'detailed' });
    expect(written.has('tile')).toBe(false);
    expect(written.has('origin')).toBe(false);
  });

  it('reads back what it wrote', () => {
    for (const settings of [
      { minBattery: 0, theme: 'auto', map: 'calm' },
      { minBattery: 30, theme: 'light', map: 'detailed' },
      { minBattery: 80, theme: 'dark', map: 'calm' },
    ] as const) {
      const parsed = parseClientParams(serializeClientParams(settings));
      expect({
        minBattery: parsed.minBattery ?? 0,
        theme: parsed.theme ?? 'auto',
        map: parsed.map ?? 'calm',
      }).toEqual(settings);
    }
  });
});
