import type { ParkingSpot } from '../domain/parkingSpot.js';
import { spotFitsVehicle, type VehicleType } from '../domain/types.js';

/**
 * A policy object, not a repository call: given these spots, in what order
 * should we try them.
 *
 * It returns a ranked list rather than one spot because the strategy cannot
 * claim anything. The service owns the claim, and needs somewhere to go when
 * the claim fails.
 */
export interface AllocationStrategy {
  rankCandidates(candidates: readonly ParkingSpot[], vehicleType: VehicleType): ParkingSpot[];
}

/**
 * Best fit: nearest floor first, then the smallest spot that still fits.
 *
 * The capacity part keeps cars out of the bus bays while compact bays are free.
 * Floor first keeps the walk short, and makes the choice deterministic.
 */
export class BestFitAllocationStrategy implements AllocationStrategy {
  rankCandidates(candidates: readonly ParkingSpot[], vehicleType: VehicleType): ParkingSpot[] {
    return candidates
      .filter((spot) => spot.isFree && spotFitsVehicle(spot.type, vehicleType))
      .sort(
        (a, b) =>
          a.floorNumber - b.floorNumber ||
          a.capacity - b.capacity ||
          a.code.localeCompare(b.code),
      );
  }
}

/**
 * Same floor ordering, but lowest code first. Kept mostly as the comparison to
 * best-fit: it is what a lot with reserved areas would fall back to.
 */
export class FirstFitAllocationStrategy implements AllocationStrategy {
  rankCandidates(candidates: readonly ParkingSpot[], vehicleType: VehicleType): ParkingSpot[] {
    return candidates
      .filter((spot) => spot.isFree && spotFitsVehicle(spot.type, vehicleType))
      .sort((a, b) => a.floorNumber - b.floorNumber || a.code.localeCompare(b.code));
  }
}
