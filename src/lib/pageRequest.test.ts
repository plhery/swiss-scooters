// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pageRequest } from '@/lib/pageRequest';

const ORIGIN = 'https://scooters.plhery.com';

describe('the request a page is rendered with', () => {
  it.each([
    ['/?origin=47.3769,8.5417', '/'],
    ['/?theme=dark&map=detailed&minBattery=60', '/'],
    ['/privacy?lang=fr', '/privacy'],
  ])('leaves the parameters of %s to the browser', (link, rendered) => {
    const request = new Request(`${ORIGIN}${link}`, { headers: { 'Accept-Language': 'fr-CH' } });
    const result = pageRequest(request);

    expect(result.url).toBe(`${ORIGIN}${rendered}`);
    expect(result.method).toBe('GET');
    expect(result.headers.get('Accept-Language')).toBe('fr-CH');
  });

  it('is the request itself when the link has no parameters', () => {
    const request = new Request(`${ORIGIN}/`);
    expect(pageRequest(request)).toBe(request);
  });

  it.each([
    '/api/scooters?lat=47.37&lng=8.54&zoom=17',
    '/api/geocode?lang=de',
    '/_next/image?url=%2Ficon-512.png&w=64&q=75',
    '/_next/static/chunks/app.js?v=1',
    '/icon.svg?v=2',
    '/sw.js?v=3',
  ])('keeps the parameters of %s, which is not a page', (path) => {
    const request = new Request(`${ORIGIN}${path}`);
    expect(pageRequest(request)).toBe(request);
  });

  it('keeps the parameters the router sends with its own requests', () => {
    const request = new Request(`${ORIGIN}/?_rsc=1a2b3`, { headers: { RSC: '1' } });
    expect(pageRequest(request)).toBe(request);
  });

  it('keeps anything that is not a read as it is', () => {
    const request = new Request(`${ORIGIN}/?origin=47.3769,8.5417`, { method: 'POST', body: '{}' });
    expect(pageRequest(request)).toBe(request);
  });
});
