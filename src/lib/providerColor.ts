import { PROVIDERS } from '@/lib/types';

/**
 * A provider's colour for what is drawn on the app's own surfaces: the dot of
 * a chip, the tint of a symbol tile. The stylesheet may replace it per
 * appearance (--provider-bird in the dark one, where Bird's near-black would
 * disappear). Markers on the map keep the plain colour: they carry a white ring.
 */
export function providerSurfaceColor(provider: string, fallback: string): string {
  const color = PROVIDERS[provider]?.color;
  return color ? `var(--provider-${provider}, ${color})` : fallback;
}
