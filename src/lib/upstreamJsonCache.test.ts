import { describe, expect, it, vi } from 'vitest';
import { UpstreamJsonCache, type UpstreamJsonOptions } from '@/lib/upstreamJsonCache';

const options: UpstreamJsonOptions = {
  headers: { Accept: 'application/json' },
  freshSeconds: 30,
  staleIfErrorSeconds: 300,
  timeoutMs: 1_000,
};
const sensitiveUrl = 'https://example.com/feed?Geometry=8.5417%2C47.3769&q=Zurich+HB';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('UpstreamJsonCache', () => {
  it('coalesces concurrent fetches and serves the fresh value from memory', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => {
      resolveResponse = resolve;
    }));
    const cache = new UpstreamJsonCache({ fetcher });

    const first = cache.fetch<{ version: number }>('https://example.com/feed', options);
    const second = cache.fetch<{ version: number }>('https://example.com/feed', options);
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolveResponse?.(jsonResponse({ version: 1 }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { data: { version: 1 }, stale: false },
      { data: { version: 1 }, stale: false },
    ]);

    await expect(cache.fetch('https://example.com/feed', options)).resolves.toEqual({
      data: { version: 1 },
      stale: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('serves stale data during an outage and backs off before retrying', async () => {
    let now = 0;
    let failing = false;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetcher = vi.fn(async () => {
      if (failing) throw new Error('upstream unavailable');
      return jsonResponse({ version: 1 });
    });
    const cache = new UpstreamJsonCache({ fetcher, now: () => now });

    await expect(cache.fetch(sensitiveUrl, options)).resolves.toEqual({
      data: { version: 1 },
      stale: false,
    });

    now = 31_000;
    failing = true;
    await expect(cache.fetch(sensitiveUrl, options)).resolves.toEqual({
      data: { version: 1 },
      stale: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledOnce();
    const logged = String(warning.mock.calls[0][0]);
    expect(JSON.parse(logged)).toEqual({
      event: 'upstream_stale_fallback',
      host: 'example.com',
      path: '/feed',
      errorType: 'Error',
    });
    expect(logged).not.toContain('Geometry');
    expect(logged).not.toContain('Zurich');

    now = 32_000;
    await expect(cache.fetch(sensitiveUrl, options)).resolves.toEqual({
      data: { version: 1 },
      stale: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    now = 331_000;
    await expect(cache.fetch(sensitiveUrl, options)).rejects.toThrow(
      'upstream unavailable'
    );
  });

  it('does not cache unsuccessful HTTP responses without a stale value', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: true }, 503));
    const cache = new UpstreamJsonCache({ fetcher });

    await expect(cache.fetch('https://example.com/feed', options)).rejects.toThrow('HTTP 503');
    await expect(cache.fetch('https://example.com/feed', options)).rejects.toThrow('HTTP 503');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
