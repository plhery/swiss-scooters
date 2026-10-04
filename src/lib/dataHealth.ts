import { PROVIDERS, PROVIDER_KEYS, providerKeyForSystemId, type ProviderKey } from '@/generated/providers';
import type { ScooterResponse, ScooterResponseMeta } from '@/lib/types';
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
  /** Providers that operate in the viewport and whose feed failed, in catalogue order. */
  down: ProviderKey[];
  /** A failed source belongs to no known provider. */
  unknown: boolean;
}

export function providerHealth(
  meta: Pick<ScooterResponseMeta, 'failedSources'> | null | undefined,
  viewportProviders: readonly string[]
): ProviderHealth {
  const failed = new Set<ProviderKey>();
  let unknown = false;
  for (const id of meta?.failedSources ?? []) {
    const provider = providerForFailedSource(id);
    if (provider) failed.add(provider);
    else unknown = true;
  }
  // The response covers a padded area, so a failed feed may belong to a
  // provider that does not operate in what is on screen. Never name those.
  return {
    down: PROVIDER_KEYS.filter(key => failed.has(key) && viewportProviders.includes(key)),
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

interface DataHealthMessages {
  cached: string;
  parkingUnavailable?: string;
  parkingStale?: string;
  partial: string;
  truncated: (shown: number, total: number) => string;
}

const DEFAULT_MESSAGES: DataHealthMessages = {
  cached: 'Showing cached data',
  parkingUnavailable: 'Parking data is temporarily unavailable',
  parkingStale: 'Parking data may be out of date',
  partial: 'Some providers unavailable',
  truncated: (shown, total) =>
    `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} results`,
};

/** The single-line notice of the current dock. The new dock uses dockModel() instead. */
export function scooterDataHealthNotice(
  meta: ScooterResponse['meta'] | null | undefined,
  returnedVehicleCount: number,
  messages: DataHealthMessages = DEFAULT_MESSAGES
): string | null {
  if (!meta) return null;

  const notices: string[] = [];
  if (meta.stale && !meta.overview) notices.push(messages.cached);
  if (meta.partial) notices.push(messages.partial);
  if (meta.parkingStatus === 'failed' || meta.parkingStatus === 'partial') notices.push(messages.parkingUnavailable ?? DEFAULT_MESSAGES.parkingUnavailable!);
  else if (meta.parkingStatus === 'stale') notices.push(messages.parkingStale ?? DEFAULT_MESSAGES.parkingStale!);
  if (meta.truncated) {
    notices.push(messages.truncated(returnedVehicleCount, meta.totalVehicles));
  }

  return notices.length > 0 ? notices.join(' · ') : null;
}
