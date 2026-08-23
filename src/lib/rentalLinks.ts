import type { RentalUris, Vehicle } from '@/generated/scooterApi';

export type RentalPlatform = 'ios' | 'android' | 'web';

interface ProviderRentalLinkPolicy {
  schemes: readonly string[];
  httpsHosts: readonly string[];
}

const PROVIDER_LINK_POLICIES: Record<string, ProviderRentalLinkPolicy> = {
  bolt: {
    schemes: ['bolt'],
    httpsHosts: ['bolt.eu', 'bolt.com'],
  },
  bird: {
    schemes: ['bird'],
    httpsHosts: ['bird.co', 'birdapp.com', 'birdapp.app.link'],
  },
  dott: {
    schemes: ['dott', 'ridedott'],
    httpsHosts: ['ridedott.com'],
  },
  hopp: {
    schemes: ['hopp'],
    httpsHosts: ['hopp.bike'],
  },
  lime: {
    schemes: ['lime', 'limebike'],
    httpsHosts: ['li.me', 'lime.bike', 'limebike.com'],
  },
  voi: {
    schemes: ['voiapp'],
    httpsHosts: ['voi.com', 'voiscooters.com', 'lqfa.adj.st'],
  },
  publibike: {
    schemes: ['publibike', 'velospot'],
    httpsHosts: ['publibike.ch', 'velospot.info'],
  },
};

const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MAX_RENTAL_URI_LENGTH = 2_048;

function matchesHost(hostname: string, allowedHost: string): boolean {
  return hostname === allowedHost || hostname.endsWith(`.${allowedHost}`);
}

export function safeRentalUri(
  provider: string,
  value: unknown,
  options: { httpsOnly?: boolean } = {}
): string | null {
  if (typeof value !== 'string') return null;

  const candidate = value.trim();
  if (
    candidate.length === 0 ||
    candidate.length > MAX_RENTAL_URI_LENGTH ||
    UNSAFE_CHARACTERS.test(candidate)
  ) return null;

  const policy = PROVIDER_LINK_POLICIES[provider];
  if (!policy) return null;

  try {
    const url = new URL(candidate);
    if (url.username || url.password) return null;

    const scheme = url.protocol.slice(0, -1).toLowerCase();
    if (scheme === 'https') {
      const hostname = url.hostname.toLowerCase();
      if (url.port || !policy.httpsHosts.some(host => matchesHost(hostname, host))) return null;
      return url.toString();
    }

    if (options.httpsOnly || !policy.schemes.includes(scheme)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeRentalUris(
  provider: string,
  rentalUris: { ios?: unknown; android?: unknown; web?: unknown } | null | undefined,
  universalFallback?: unknown
): RentalUris {
  const fallback = safeRentalUri(provider, universalFallback);
  const webFallback = fallback?.startsWith('https:') ? fallback : null;

  return {
    ios: safeRentalUri(provider, rentalUris?.ios) ?? fallback,
    android: safeRentalUri(provider, rentalUris?.android) ?? fallback,
    web: safeRentalUri(provider, rentalUris?.web, { httpsOnly: true }) ?? webFallback,
  };
}

export function legacyRentalLink(rentalUris: RentalUris): string | null {
  if (rentalUris.web) return rentalUris.web;
  if (
    rentalUris.ios &&
    rentalUris.ios === rentalUris.android &&
    rentalUris.ios.startsWith('https:')
  ) return rentalUris.ios;
  return null;
}

export function rentalPlatform(
  userAgent: string,
  maximumTouchPoints = 0
): RentalPlatform {
  if (/android/i.test(userAgent)) return 'android';
  if (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maximumTouchPoints > 1)
  ) return 'ios';
  return 'web';
}

export function rentalLinkForPlatform(
  vehicle: Vehicle,
  platform: RentalPlatform
): string | null {
  const rentalUris = vehicle.rental_uris;
  const candidates = platform === 'ios'
    ? [rentalUris?.ios, rentalUris?.web, vehicle.deep_link]
    : platform === 'android'
      ? [rentalUris?.android, rentalUris?.web, vehicle.deep_link]
      : [rentalUris?.web, vehicle.deep_link];

  for (const candidate of candidates) {
    const safe = safeRentalUri(vehicle.provider, candidate, { httpsOnly: platform === 'web' });
    if (safe) return safe;
  }
  return null;
}

export function browserRentalLink(
  vehicle: Vehicle,
  userAgent: string,
  maximumTouchPoints = 0
): string | null {
  return rentalLinkForPlatform(
    vehicle,
    rentalPlatform(userAgent, maximumTouchPoints)
  );
}
