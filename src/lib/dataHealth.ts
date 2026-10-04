import { PROVIDERS, PROVIDER_KEYS, providerKeyForSystemId, type ProviderKey } from '@/generated/providers';
import { boundsContainPoint } from '@/lib/geo';
import type { MapBounds, ScooterCluster, ScooterResponseMeta, Vehicle } from '@/lib/types';
import type { UiText } from '@/lib/uiText';

/**
 * The provider behind an entry of meta.failedSources. Those ids name the feed
 * with its source in front ("national:lime_zurich", "france:dott_fr_bordeaux",
 * plain "hopp"), so the source has to go before the system id can be matched.
 * Null for ids that belong to no provider, such as "city-overview".
 */
export function providerForFailedSource(id: string): ProviderKey | null {
  return providerKeyForSystemId(id.slice(id.indexOf(':') + 1));
}

export interface ProviderHealth {
  /**
   * Providers that operate in the viewport, had a feed fail and show nothing
   * here, in catalogue order.
   */
  down: ProviderKey[];
  /** A failed source belongs to no known provider. */
  unknown: boolean;
}

const HEALTHY: ProviderHealth = { down: [], unknown: false };

/**
 * The providers with a scooter of the loaded data inside the viewport, counted
 * as the chips count them but whatever the rider's own filters hide. Null when
 * the data cannot tell: the server already left out the scooters under the
 * rider's battery minimum.
 */
export function providersInView({ vehicles, clusters, viewport, serverMinBattery }: {
  vehicles: readonly Pick<Vehicle, 'provider' | 'lat' | 'lng'>[];
  clusters: readonly Pick<ScooterCluster, 'lat' | 'lng' | 'providers'>[];
  viewport: MapBounds | null;
  /** The minBattery of the query that produced the response. */
  serverMinBattery: number;
}): Set<string> | null {
  if (!viewport || serverMinBattery > 0) return null;
  const providers = new Set<string>();
  for (const vehicle of vehicles) {
    if (boundsContainPoint(viewport, vehicle.lat, vehicle.lng)) providers.add(vehicle.provider);
  }
  for (const cluster of clusters) {
    if (!boundsContainPoint(viewport, cluster.lat, cluster.lng)) continue;
    for (const [provider, count] of Object.entries(cluster.providers)) {
      if (count > 0) providers.add(provider);
    }
  }
  return providers;
}

/**
 * Who is not sharing data in the viewport. One failed feed is not enough: a
 * provider is down only when it also has no scooter in view, because its other
 * feeds may well cover what is on screen.
 */
export function providerHealth({ meta, viewportProviders, inView }: {
  meta: Pick<ScooterResponseMeta, 'failedSources' | 'overview'> | null | undefined;
  /** Providers that operate in the viewport. */
  viewportProviders: readonly string[];
  /**
   * From providersInView(). Null when what is on screen cannot tell who has
   * scooters here, as it was loaded for another view or filtered by the server:
   * then nobody is named.
   */
  inView: ReadonlySet<string> | null;
}): ProviderHealth {
  // City totals are a snapshot of their own: a failed feed says nothing about them.
  if (!meta || meta.overview || !inView) return HEALTHY;
  const failed = new Set<ProviderKey>();
  let unknown = false;
  for (const id of meta.failedSources) {
    const provider = providerForFailedSource(id);
    if (provider) failed.add(provider);
    else unknown = true;
  }
  // The response covers a padded area, so a failed feed may belong to a
  // provider that does not operate in what is on screen. Never name those.
  return {
    down: PROVIDER_KEYS.filter(key => failed.has(key) && viewportProviders.includes(key) && !inView.has(key)),
    unknown,
  };
}

/** The dock notice for providers that are not sharing data; null when all of them are. */
export function providersDownNotice({ down, unknown }: ProviderHealth): UiText | null {
  const names = down.map(key => PROVIDERS[key].name);
  if (names.length === 1) return { key: 'dock.down.one', values: { name: names[0] } };
  if (names.length === 2) return { key: 'dock.down.two', values: { first: names[0], second: names[1] } };
  if (names.length > 2) return { key: 'dock.down.many', numbers: { count: names.length } };
  return unknown ? { key: 'dock.down.some' } : null;
}
