export type {
  FeedSourceStatus,
  RentalUris,
  ScooterCluster,
  ScooterResponse,
  ScooterResponseMeta,
  ScooterResponseMode,
  Vehicle,
} from '@/generated/scooterApi';

export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export {
  PROVIDERS,
  PROVIDER_KEYS,
  type ProviderConfig,
  type ProviderKey,
} from '@/generated/providers';
