import { describe, expect, it } from 'vitest';
import { legacyHostRedirect } from '@/lib/legacyHost';

describe('legacy hostname compatibility', () => {
  it('redirects browser routes to the canonical hostname', () => {
    const response = legacyHostRedirect(new Request(
      'https://zurich-scooter.plhery.com/privacy?lang=fr'
    ));

    expect(response?.status).toBe(308);
    expect(response?.headers.get('location')).toBe(
      'https://swiss-scooters.plhery.com/privacy?lang=fr'
    );
  });

  it('keeps legacy API routes available for installed clients', () => {
    const response = legacyHostRedirect(new Request(
      'https://zurich-scooter.plhery.com/api/scooters?lat=47.37&lng=8.54'
    ));

    expect(response).toBeNull();
  });

  it('leaves the canonical hostname unchanged', () => {
    expect(legacyHostRedirect(new Request(
      'https://swiss-scooters.plhery.com/privacy'
    ))).toBeNull();
  });
});
