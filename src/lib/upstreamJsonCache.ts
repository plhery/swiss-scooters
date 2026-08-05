const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_ERROR_RETRY_SECONDS = 15;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface CacheEntry {
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
}

export interface UpstreamJsonOptions {
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
      return { data: entry.value as T, stale: false };
    }
    if (entry?.hasValue && entry.staleUntil > now && entry.retryAfter > now) {
      return { data: entry.value as T, stale: true };
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

  clear(): void {
    this.entries.clear();
  }

  private async fetchFresh<T>(
    url: string,
    entry: CacheEntry,
    options: UpstreamJsonOptions
  ): Promise<CachedJson<T>> {
    try {
      const response = await this.fetcher(url, {
        headers: options.headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`GBFS request failed with HTTP ${response.status}`);
      }

      const data = await response.json() as T;
      const completedAt = this.now();
      entry.value = data;
      entry.hasValue = true;
      entry.freshUntil = completedAt + options.freshSeconds * 1000;
      entry.staleUntil = entry.freshUntil + options.staleIfErrorSeconds * 1000;
      entry.retryAfter = 0;
      return { data, stale: false };
    } catch (error) {
      const failedAt = this.now();
      if (entry.hasValue && entry.staleUntil > failedAt) {
        entry.retryAfter = failedAt + this.errorRetryMs;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(JSON.stringify({ event: 'upstream_stale_fallback', url, message }));
        return { data: entry.value as T, stale: true };
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
