import type { SpotType } from '../domain/types.js';

export interface AvailabilityLine {
  floorNumber: number;
  spotType: SpotType;
  free: number;
  total: number;
}

/**
 * Computed on read from the spot table. No cached counter: one missed decrement
 * makes it wrong forever, and showing a free bay that is taken is worse than
 * paying for a group-by.
 */
export interface AvailabilitySnapshot {
  free: number;
  total: number;
  lines: AvailabilityLine[];
}
