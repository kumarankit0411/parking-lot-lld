/**
 * Shared enums plus the "what fits where" rule.
 *
 * Vehicles and spots are ranked 1-3 instead of using a type-by-type matrix.
 * A matrix needs a new row and column for every size; this needs one number.
 */

export enum VehicleType {
  MOTORCYCLE = 'MOTORCYCLE',
  CAR = 'CAR',
  BUS = 'BUS',
}

export enum SpotType {
  MOTORCYCLE = 'MOTORCYCLE',
  COMPACT = 'COMPACT',
  LARGE = 'LARGE',
}

export enum SpotStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
}

export enum TicketStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  UPI = 'UPI',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

/** How much room a vehicle needs. */
export const VEHICLE_SPACE: Record<VehicleType, number> = {
  [VehicleType.MOTORCYCLE]: 1,
  [VehicleType.CAR]: 2,
  [VehicleType.BUS]: 3,
};

/** How much room a spot offers. Mirrors the generated column in schema.sql. */
export const SPOT_CAPACITY: Record<SpotType, number> = {
  [SpotType.MOTORCYCLE]: 1,
  [SpotType.COMPACT]: 2,
  [SpotType.LARGE]: 3,
};

/**
 * Upsizing is allowed, downsizing is not. A car may use a bus bay, a bus may
 * never use a compact one.
 */
export function spotFitsVehicle(spot: SpotType, vehicle: VehicleType): boolean {
  return SPOT_CAPACITY[spot] >= VEHICLE_SPACE[vehicle];
}
