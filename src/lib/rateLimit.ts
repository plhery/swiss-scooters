import { getCloudflareContext } from '@opennextjs/cloudflare';

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

type RateLimitBindingName = 'SCOOTER_API_RATE_LIMITER' | 'GEOCODE_API_RATE_LIMITER';

function clientKey(request: Request): string {
  return request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'local-development';
}

export async function rateLimitAllows(
  request: Request,
  bindingName: RateLimitBindingName
): Promise<boolean> {
  try {
    const context = await getCloudflareContext({ async: true });
    const binding = (context.env as CloudflareEnv & Record<string, unknown>)[bindingName] as
      RateLimitBinding | undefined;
    if (!binding) return true;

    const result = await binding.limit({ key: clientKey(request) });
    return result.success;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(JSON.stringify({ event: 'rate_limit_unavailable', bindingName, message }));
    return true;
  }
}
