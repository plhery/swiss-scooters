const LEGACY_HOST = 'zurich-scooter.plhery.com';
const CANONICAL_HOST = 'swiss-scooters.plhery.com';

export function legacyHostRedirect(request: Request): Response | null {
  const source = new URL(request.url);
  if (source.hostname !== LEGACY_HOST || source.pathname.startsWith('/api/')) {
    return null;
  }

  source.hostname = CANONICAL_HOST;
  source.protocol = 'https:';
  source.port = '';
  return Response.redirect(source, 308);
}
