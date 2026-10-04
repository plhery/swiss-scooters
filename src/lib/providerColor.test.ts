import { describe, expect, it } from 'vitest';
import { providerSurfaceColor } from '@/lib/providerColor';

describe('providerSurfaceColor', () => {
  it('lets the stylesheet replace a provider colour and falls back to the catalogue', () => {
    expect(providerSurfaceColor('bird', '#8e8e93')).toBe('var(--provider-bird, #222222)');
    expect(providerSurfaceColor('lime', '#8e8e93')).toBe('var(--provider-lime, #32cd32)');
  });

  it('uses the given colour for a provider that is not in the catalogue', () => {
    expect(providerSurfaceColor('unknown', '#8e8e93')).toBe('#8e8e93');
  });
});
