import { describe, expect, it } from 'vitest';
import type { Vehicle } from '@/lib/types';
import {
  browserRentalLink,
  legacyRentalLink,
  normalizeRentalUris,
  rentalLinkForPlatform,
  rentalPlatform,
  safeRentalUri,
} from '@/lib/rentalLinks';

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    provider: 'dott',
    lat: 47.3769,
    lng: 8.5417,
    battery: 80,
    range_m: 10_000,
    vehicle_id: 'dott:1',
    deep_link: null,
    distance_m: null,
    ...overrides,
  };
}

describe('rental links', () => {
  it('preserves a trusted universal fallback for every platform', () => {
    const link = 'https://app.hopp.bike/launch/vehicle-1?direct';

    const rentalUris = normalizeRentalUris('hopp', undefined, link);

    expect(rentalUris).toEqual({ ios: link, android: link, web: link });
    expect(legacyRentalLink(rentalUris)).toBe(link);
  });

  it('rejects script URLs, cross-provider schemes, spoofed hosts, and credentials', () => {
    expect(safeRentalUri('lime', 'javascript:alert(1)')).toBeNull();
    expect(safeRentalUri('lime', 'bolt://action/rent')).toBeNull();
    expect(safeRentalUri('hopp', 'https://app.hopp.bike.example.com/launch/1')).toBeNull();
    expect(safeRentalUri('hopp', 'https://user@app.hopp.bike/launch/1')).toBeNull();
  });

  it('selects only the link intended for the current mobile platform', () => {
    const ios = 'https://go.ridedott.com/vehicles/1?platform=ios';
    const android = 'https://go.ridedott.com/vehicles/1?platform=android';
    const scooter = vehicle({
      rental_uris: { ios, android, web: null },
    });

    expect(rentalLinkForPlatform(scooter, 'ios')).toBe(ios);
    expect(rentalLinkForPlatform(scooter, 'android')).toBe(android);
    expect(rentalLinkForPlatform(scooter, 'web')).toBeNull();
  });

  it('does not offer a custom app scheme to desktop browsers', () => {
    const scooter = vehicle({
      provider: 'bolt',
      deep_link: 'bolt://action/rentalsSelectVehicleByRotatedUuid?rotated_uuid=1',
      rental_uris: {
        ios: 'bolt://action/rentalsSelectVehicleByRotatedUuid?rotated_uuid=1',
        android: 'bolt://action/rentalsSelectVehicleByRotatedUuid?rotated_uuid=1',
        web: null,
      },
    });

    expect(rentalLinkForPlatform(scooter, 'web')).toBeNull();
    expect(rentalLinkForPlatform(scooter, 'ios')).toContain('bolt://');
  });

  it('detects Android, iOS, iPadOS, and desktop clients', () => {
    expect(rentalPlatform('Mozilla/5.0 (Linux; Android 16)')).toBe('android');
    expect(rentalPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0)')).toBe('ios');
    expect(rentalPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5)).toBe('ios');
    expect(rentalPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('web');
  });

  it('uses browser detection before selecting a link', () => {
    const scooter = vehicle({
      rental_uris: {
        ios: 'https://go.ridedott.com/vehicles/1?platform=ios',
        android: 'https://go.ridedott.com/vehicles/1?platform=android',
        web: null,
      },
    });

    expect(browserRentalLink(scooter, 'Mozilla/5.0 (Linux; Android 16)')).toContain(
      'platform=android'
    );
  });
});
