import { expect, it, vi } from 'vitest';
import { fetchLilleParking, normalizeLilleParking } from './lilleParking';
import { fetchJson } from './scooterFeeds';
import { FRENCH_SCOOTER_SYSTEMS } from './frenchScooterSystems';
const system = FRENCH_SCOOTER_SYSTEMS.find(system => system.id === 'lime_fr_lille')!;
vi.mock('./scooterFeeds', () => ({ fetchJson: vi.fn() }));
it('includes municipal scooter bays, excludes bike-only/planned/outside locations, and credits MEL', () => {
  const bay = { id: 'bay.1', geometry: { type: 'Point', coordinates: [3.05,50.65] },
    properties: { typologie: 'STATIONNEMENT', type_engin: 'TE + VAE', numero_voie: '12', nom_voie: 'Rue test' } };
  const result = normalizeLilleParking([bay, bay,
    { ...bay, id: 'pedestrian', properties: { ...bay.properties, typologie: 'ESPACE PIETON' } },
    { ...bay, id: 'bike', properties: { ...bay.properties, type_engin: 'VAE' } },
    { ...bay, id: 'future', properties: { ...bay.properties, typologie: 'PROJET' } },
    { ...bay, id: 'outside', geometry: { type: 'Point', coordinates: [4.85,45.75] } },
  ], system);
  expect(result).toEqual([{ id: 'lime_fr_lille:mel:bay.1', provider: 'lime', name: '12 Rue test (MEL)',
    lat: 50.65, lng: 3.05, mandatory: true },
    { id: 'lime_fr_lille:mel:pedestrian', provider: 'lime', name: '12 Rue test (MEL)',
    lat: 50.65, lng: 3.05, mandatory: true }]);
});

it('completes pagination when the server returns fewer records than the requested page size', async () => {
  const bay = { id: 'one', geometry: { type: 'Point', coordinates: [3.05, 50.65] },
    properties: { typologie: 'ESPACE PIETON', type_engin: 'TE + VAE' } };
  const fetch = vi.mocked(fetchJson);
  fetch.mockResolvedValueOnce({ data: { features: [bay], numberMatched: 2 }, stale: false, fetchedAt: Date.now() });
  fetch.mockResolvedValueOnce({ data: { features: [{ ...bay, id: 'two' }], numberMatched: 2 }, stale: false, fetchedAt: Date.now() });
  const result = await fetchLilleParking(system);
  expect(result.locations).toHaveLength(2);
  expect(new URL(fetch.mock.calls[1][0]).searchParams.get('startIndex')).toBe('1');
});
