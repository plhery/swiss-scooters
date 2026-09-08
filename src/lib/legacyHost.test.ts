import { describe, expect, it } from 'vitest';
import { legacyHostRedirect } from '@/lib/legacyHost';

describe.each(['zurich-scooter.plhery.com', 'swiss-scooters.plhery.com'])('legacy hostname compatibility: %s', (hostname) => {
  it('redirects browser routes to the canonical hostname', () => {
    const response = legacyHostRedirect(new Request(
      `https://${hostname}/privacy?lang=fr`
    ));

    expect(response?.status).toBe(308);
    expect(response?.headers.get('location')).toBe(
      'https://scooters.plhery.com/privacy?lang=fr'
    );
  });

  it.each(['scooters?lat=47.37&lng=8.54', 'geocode?q=Paris'])('keeps legacy API route %s available for installed clients', (route) => {
    const response = legacyHostRedirect(new Request(
      `https://${hostname}/api/${route}`
    ));

    expect(response).toBeNull();
  });

  it('serves service-worker updates on their original origin', () => {
    expect(legacyHostRedirect(new Request(`https://${hostname}/sw.js`))).toBeNull();
  });

  it('leaves the canonical hostname unchanged', () => {
    expect(legacyHostRedirect(new Request(
      'https://scooters.plhery.com/privacy'
    ))).toBeNull();
  });
});
