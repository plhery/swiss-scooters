import { REGIONAL_SCOOTER_SYSTEMS, searchRegionalScooterCities } from './regionalScooterSystems';
export type { RegionalScooterSystem as FrenchScooterSystem } from './regionalScooterSystems';

// Compatibility exports for the French feed checker and its existing fixtures.
export const FRENCH_SCOOTER_SYSTEMS = REGIONAL_SCOOTER_SYSTEMS.filter(system => system.country === 'FR');
export const searchFrenchScooterCities = (query: string) => searchRegionalScooterCities(query, ['FR']);
