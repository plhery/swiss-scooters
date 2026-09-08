import type { FrenchScooterSystem } from './frenchScooterSystems';
import { boundsContainPoint } from './geo';
import { fetchJson } from './scooterFeeds';
import type { ParkingLocation } from './types';

// Official MEL inventory of mandatory shared e-scooter/e-bike parking.
const endpoint = 'https://data.lillemetropole.fr/geoserver/ogc/features/v1/collections/mel_mobilite_et_transport:edpm_vae_libreservice/items';
export interface LilleParkingFeature {
  id?: string;
  geometry?: { type?: string; coordinates?: number[] };
  properties?: { objectid?: number; numero_voie?: string; nom_voie?: string; commune?: string;
    typologie?: string; type_engin?: string };
}
export function normalizeLilleParking(features: LilleParkingFeature[], system: FrenchScooterSystem): ParkingLocation[] {
  const locations = new Map<string, ParkingLocation>();
  for (const feature of features) {
    const properties = feature.properties;
    const point = feature.geometry?.coordinates;
    if (feature.geometry?.type !== 'Point' || !point || !point.slice(0, 2).every(Number.isFinite) ||
      point.length < 2 || !boundsContainPoint(system.bounds, point[1], point[0]) ||
      !['STATIONNEMENT', 'ESPACE PIETON', 'AUTRE'].includes(properties?.typologie ?? '') ||
      !properties?.type_engin?.split(/\s*\+\s*/).includes('TE')) continue;
    const sourceID = feature.id ?? (properties.objectid === undefined ? undefined : String(properties.objectid));
    if (!sourceID) continue;
    const id = `${system.id}:mel:${sourceID}`;
    const address = [properties.numero_voie, properties.nom_voie, properties.commune].filter(Boolean).join(' ').trim();
    locations.set(id, { id, provider: system.provider, name: `${address || system.city} (MEL)`,
      lat: point[1], lng: point[0], mandatory: true });
  }
  return [...locations.values()];
}
export async function fetchLilleParking(system: FrenchScooterSystem) {
  const features: LilleParkingFeature[] = [];
  let stale = false;
  // Construct pagination on the reviewed endpoint; never follow arbitrary feed links.
  for (let page = 0; page < 10; page++) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({ f: 'application/geo+json', limit: '1000', startIndex: String(features.length) }).toString();
    const response = await fetchJson<{ features?: LilleParkingFeature[]; numberMatched?: number }>(url.toString(), { revalidate: 3600 });
    if (!Array.isArray(response.data.features)) throw new Error('Invalid MEL parking inventory');
    stale ||= response.stale;
    features.push(...response.data.features);
    if (!response.data.features.length && features.length < (response.data.numberMatched ?? 0)) throw new Error('Incomplete MEL parking inventory');
    if (!response.data.features.length || features.length >= (response.data.numberMatched ?? Infinity) ||
      (response.data.numberMatched === undefined && response.data.features.length < 1000)) {
      return { locations: normalizeLilleParking(features, system), stale };
    }
  }
  throw new Error('MEL parking inventory exceeds the collection limit');
}
