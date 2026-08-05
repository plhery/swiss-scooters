import { afterEach, describe, expect, it, vi } from 'vitest';

const getCloudflareContext = vi.hoisted(() => vi.fn());

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext }));

import { rateLimitAllows } from '@/lib/rateLimit';

const request = new Request('https://example.com/api/scooters', {
  headers: { 'cf-connecting-ip': '203.0.113.10' },
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('rateLimitAllows', () => {
  it('fails closed in production when the binding is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    getCloudflareContext.mockResolvedValue({ env: {} });

    await expect(rateLimitAllows(request, 'SCOOTER_API_RATE_LIMITER')).resolves.toBe(false);
  });

  it('fails open for local tests when the binding is missing', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    getCloudflareContext.mockResolvedValue({ env: {} });

    await expect(rateLimitAllows(request, 'SCOOTER_API_RATE_LIMITER')).resolves.toBe(true);
  });

  it('uses the Cloudflare client IP as the limiter key', async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    getCloudflareContext.mockResolvedValue({
      env: { SCOOTER_API_RATE_LIMITER: { limit } },
    });

    await expect(rateLimitAllows(request, 'SCOOTER_API_RATE_LIMITER')).resolves.toBe(true);
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.10' });
  });
});
