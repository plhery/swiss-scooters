// Keep the reviewed four-country catalog (up to nine documents per feed) resident.
// Otherwise the minute collector evicts hourly metadata before its next pass.
const DEFAULT_MAX_ENTRIES = 2048;
const DEFAULT_ERROR_RETRY_SECONDS = 15;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

class UpstreamHttpError extends Error {
  constructor(readonly status: number) {
    super(`GBFS request failed with HTTP ${status}`);
    this.name = 'UpstreamHttpError';
  }
}

function safeUpstreamTarget(value: string): { host: string; path: string } {
  try {
    const url = new URL(value);
    return { host: url.host, path: url.pathname };
  } catch {
    return { host: 'invalid-url', path: '/' };
  }
}

interface CacheEntry {
  fetchedAt: number;
  freshUntil: number;
  staleUntil: number;
  retryAfter: number;
  hasValue: boolean;
  value?: unknown;
  pending?: Promise<CachedJson<unknown>>;
}

export interface CachedJson<T> {
  data: T;
  stale: boolean;
  fetchedAt: number;
}

export interface UpstreamJsonOptions {
  validate?: (value: unknown) => void;
  headers: Record<string, string>;
  freshSeconds: number;
  staleIfErrorSeconds: number;
  timeoutMs: number;
}

interface UpstreamJsonCacheOptions {
  fetcher?: Fetcher;
  maxEntries?: number;
  errorRetrySeconds?: number;
  now?: () => number;
}

export class UpstreamJsonCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly hostIntervals = new Map<string, number>();
  private readonly nextRequests = new Map<string, number>();
  private readonly fetcher: Fetcher;
  private readonly maxEntries: number;
  private readonly errorRetryMs: number;
  private readonly now: () => number;

  constructor(options: UpstreamJsonCacheOptions = {}) {
    this.fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.errorRetryMs = (options.errorRetrySeconds ?? DEFAULT_ERROR_RETRY_SECONDS) * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  async fetch<T>(url: string, options: UpstreamJsonOptions): Promise<CachedJson<T>> {
    const now = this.now();
    let entry = this.entries.get(url);

    if (entry?.hasValue && entry.freshUntil > now) {
      return { data: entry.value as T, stale: false, fetchedAt: entry.fetchedAt };
    }
    if (entry?.hasValue && entry.staleUntil > now && entry.retryAfter > now) {
      return { data: entry.value as T, stale: true, fetchedAt: entry.fetchedAt };
    }
    if (entry?.pending) {
      return entry.pending as Promise<CachedJson<T>>;
    }

    this.removeExpiredEntries(now);
    entry = this.entries.get(url) ?? this.createEntry(url);

    const request = this.fetchFresh<T>(url, entry, options);
    entry.pending = request as Promise<CachedJson<unknown>>;

    try {
      return await request;
    } finally {
      if (entry.pending === request) entry.pending = undefined;
    }
  }

  /** Collector pacing prevents large country catalogs from bursting upstream quotas. */
  paceHost(hostname: string, intervalMs: number): void {
    this.hostIntervals.set(hostname, Math.max(0, intervalMs));
  }

  clear(): void {
    this.entries.clear();
    this.nextRequests.clear();
  }

  private async waitForHost(url: string): Promise<void> {
    const host = new URL(url).hostname;
    const interval = this.hostIntervals.get(host) ?? 0;
    if (!interval) return;
    const now = this.now();
    const start = Math.max(now, this.nextRequests.get(host) ?? 0);
    this.nextRequests.set(host, start + interval);
    if (start > now) await new Promise(resolve => setTimeout(resolve, start - now));
  }

  private async fetchFresh<T>(
    url: string,
    entry: CacheEntry,
    options: UpstreamJsonOptions
  ): Promise<CachedJson<T>> {
    try {
      if (this.hostIntervals.size) await this.waitForHost(url);
      const response = await this.fetcher(url, {
        headers: options.headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        throw new UpstreamHttpError(response.status);
      }

      const data = await response.json() as T;
      options.validate?.(data);
      const completedAt = this.now();
      entry.fetchedAt = completedAt;
      entry.value = data;
      entry.hasValue = true;
      entry.freshUntil = completedAt + options.freshSeconds * 1000;
      entry.staleUntil = entry.freshUntil + options.staleIfErrorSeconds * 1000;
      entry.retryAfter = 0;
      return { data, stale: false, fetchedAt: completedAt };
    } catch (error) {
      const failedAt = this.now();
      if (entry.hasValue && entry.staleUntil > failedAt) {
        entry.retryAfter = failedAt + this.errorRetryMs;
        console.warn(JSON.stringify({
          event: 'upstream_stale_fallback',
          ...safeUpstreamTarget(url),
          ...(error instanceof UpstreamHttpError
            ? { httpStatus: error.status }
            : { errorType: error instanceof Error ? error.name : 'UnknownError' }),
        }));
        return { data: entry.value as T, stale: true, fetchedAt: entry.fetchedAt };
      }

      this.entries.delete(url);
      throw error;
    }
  }

  private createEntry(url: string): CacheEntry {
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }

    const entry: CacheEntry = {
      fetchedAt: 0,
      freshUntil: 0,
      staleUntil: 0,
      retryAfter: 0,
      hasValue: false,
    };
    this.entries.set(url, entry);
    return entry;
  }

  private removeExpiredEntries(now: number): void {
    for (const [key, entry] of this.entries) {
      if (!entry.pending && (!entry.hasValue || entry.staleUntil <= now)) {
        this.entries.delete(key);
      }
    }
  }
}

export const upstreamJsonCache = new UpstreamJsonCache();
