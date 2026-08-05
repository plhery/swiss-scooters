import { describe, expect, it } from 'vitest';
import {
  parseClientParams,
  parseStoredClientParams,
  serializeClientParams,
} from '@/lib/clientParams';

describe('client params', () => {
  it('parses valid URL settings', () => {
    expect(parseClientParams(new URLSearchParams({
      origin: '47.3769,8.5417',
      minBattery: '25',
      tile: 'dark',
    }))).toEqual({
      origin: [47.3769, 8.5417],
      minBattery: 25,
      tileLayer: 'dark',
    });
  });

  it('rejects out-of-range coordinates and malformed values', () => {
    expect(parseClientParams(new URLSearchParams({
      origin: '999,999',
      minBattery: 'abc',
      tile: 'sepia',
    }))).toEqual({
      origin: null,
      minBattery: undefined,
      tileLayer: undefined,
    });
  });

  it('clamps and rounds battery values to the supported slider steps', () => {
    expect(parseClientParams(new URLSearchParams({ minBattery: '103' })).minBattery).toBe(100);
    expect(parseClientParams(new URLSearchParams({ minBattery: '23' })).minBattery).toBe(25);
    expect(parseClientParams(new URLSearchParams({ minBattery: '-2' })).minBattery).toBe(0);
  });

  it('accepts only recognized string values from storage', () => {
    expect(parseStoredClientParams(JSON.stringify({
      origin: '47.4,8.5',
      minBattery: 50,
      tile: 'osm',
      extra: 'ignored',
    }))).toEqual({
      origin: [47.4, 8.5],
      minBattery: undefined,
      tileLayer: 'osm',
    });
    expect(parseStoredClientParams('["47.4,8.5"]')).toBeNull();
    expect(parseStoredClientParams('{bad json')).toBeNull();
  });

  it('serializes only non-default settings', () => {
    expect(serializeClientParams({
      origin: [47.3769, 8.5417],
      minBattery: 0,
      tileLayer: 'light',
    }).toString()).toBe('origin=47.3769%2C8.5417');
  });
});
