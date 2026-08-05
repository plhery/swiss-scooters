const policy = (directives: string[]): string => `${directives.join('; ')};`;

export function documentContentSecurityPolicy({
  nonce,
  development,
  upgradeInsecureRequests = !development,
}: {
  nonce: string;
  development: boolean;
  upgradeInsecureRequests?: boolean;
}): string {
  const nonceSource = `'nonce-${nonce}'`;

  return policy([
    "default-src 'self'",
    `script-src 'self' ${nonceSource} 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    "script-src-attr 'none'",
    // CSP2 fallback. Modern browsers use the narrower style-src-elem and
    // style-src-attr directives below.
    "style-src 'self' 'unsafe-inline'",
    `style-src-elem 'self' ${nonceSource}${development ? " 'unsafe-inline'" : ''}`,
    "style-src-attr 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: https://tile.openstreetmap.org https://*.basemaps.cartocdn.com",
    `connect-src 'self'${development ? ' ws: wss:' : ''}`,
    `worker-src 'self'${development ? ' blob:' : ''}`,
    "child-src 'self'",
    "frame-src 'none'",
    "media-src 'none'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(upgradeInsecureRequests ? ['upgrade-insecure-requests'] : []),
  ]);
}

export const API_CONTENT_SECURITY_POLICY = policy([
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  'sandbox',
]);

export const SERVICE_WORKER_CONTENT_SECURITY_POLICY = policy([
  "default-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "connect-src 'self'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
]);
