/** Maximum age of individual scooter positions, measured from the source timestamp. */
export const VEHICLE_MAX_AGE_MS = 10 * 60_000;

/** Parking availability expires independently of scooter positions. */
export const PARKING_MAX_AGE_MS = 5 * 60_000;
