import { describe, expect, it } from 'vitest';
import { shouldClusterAtZoom } from '@/lib/clustering';

describe('web clustering', () => {
  it('clusters through zoom 15 and separates scooters above it', () => {
    expect(shouldClusterAtZoom(14)).toBe(true);
    expect(shouldClusterAtZoom(15)).toBe(true);
    expect(shouldClusterAtZoom(16)).toBe(false);
  });

  it('rejects invalid zoom values', () => {
    expect(shouldClusterAtZoom(Number.NaN)).toBe(false);
    expect(shouldClusterAtZoom(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
