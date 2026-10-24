import { describe, expect, it } from 'vitest';
import {
  BestFitAllocationStrategy,
  FirstFitAllocationStrategy,
} from '../src/allocation/allocationStrategy.js';
import { ParkingSpot } from '../src/domain/parkingSpot.js';
import { SpotStatus, SpotType, VehicleType } from '../src/domain/types.js';

const bestFit = new BestFitAllocationStrategy();
const firstFit = new FirstFitAllocationStrategy();

function spot(
  id: string,
  floorNumber: number,
  code: string,
  type: SpotType,
  status: SpotStatus = SpotStatus.AVAILABLE,
): ParkingSpot {
  return new ParkingSpot(id, floorNumber, code, type, status);
}

function codes(spots: ParkingSpot[]): string[] {
  return spots.map((candidate) => candidate.code);
}

describe('best fit allocation', () => {
  it('prefers the smallest spot that fits on the nearest floor', () => {
    const floorOne = [
      spot('1', 1, 'F1-M01', SpotType.MOTORCYCLE),
      spot('2', 1, 'F1-L01', SpotType.LARGE),
      spot('3', 1, 'F1-C01', SpotType.COMPACT),
    ];

    expect(codes(bestFit.rankCandidates(floorOne, VehicleType.CAR))).toEqual([
      'F1-C01',
      'F1-L01',
    ]);
  });

  it('upsizes when nothing smaller is free', () => {
    const spots = [spot('1', 1, 'F1-L01', SpotType.LARGE), spot('2', 1, 'F1-C01', SpotType.COMPACT, SpotStatus.OCCUPIED)];

    expect(codes(bestFit.rankCandidates(spots, VehicleType.CAR))).toEqual(['F1-L01']);
  });

  it('never puts a bus in a compact or motorcycle bay', () => {
    const spots = [
      spot('1', 1, 'F1-M01', SpotType.MOTORCYCLE),
      spot('2', 1, 'F1-C01', SpotType.COMPACT),
    ];

    expect(bestFit.rankCandidates(spots, VehicleType.BUS)).toEqual([]);
  });

  it('lets a motorcycle use anything, smallest first', () => {
    const spots = [
      spot('1', 1, 'F1-C01', SpotType.COMPACT),
      spot('2', 1, 'F1-M01', SpotType.MOTORCYCLE),
      spot('3', 1, 'F1-L01', SpotType.LARGE),
    ];

    expect(codes(bestFit.rankCandidates(spots, VehicleType.MOTORCYCLE))).toEqual([
      'F1-M01',
      'F1-C01',
      'F1-L01',
    ]);
  });

  it('takes a big bay one floor down before a smaller bay two floors up', () => {
    // This is a real trade-off, not an accident: floor is compared first so
    // drivers walk less. The cost is that a car can still hold a LARGE bay while
    // COMPACT bays sit free on an upper floor. See DESIGN.md, "Known limits".
    const spots = [
      spot('1', 2, 'F2-C01', SpotType.COMPACT),
      spot('2', 1, 'F1-L01', SpotType.LARGE),
    ];

    expect(codes(bestFit.rankCandidates(spots, VehicleType.CAR))).toEqual([
      'F1-L01',
      'F2-C01',
    ]);
  });

  it('ignores spots that are occupied or out of service', () => {
    const spots = [
      spot('1', 1, 'F1-C01', SpotType.COMPACT, SpotStatus.OCCUPIED),
      spot('2', 1, 'F1-C02', SpotType.COMPACT, SpotStatus.OUT_OF_SERVICE),
      spot('3', 1, 'F1-L01', SpotType.LARGE),
    ];

    expect(codes(bestFit.rankCandidates(spots, VehicleType.CAR))).toEqual(['F1-L01']);
  });

  it('returns nothing when the lot cannot take the vehicle', () => {
    expect(bestFit.rankCandidates([], VehicleType.CAR)).toEqual([]);
  });
});

describe('first fit allocation', () => {
  it('for a motorcycle, takes a COMPACT bay before a MOTORCYCLE one', () => {
    // Worth being explicit about: with the 'F1-M/C/L' code scheme, first-fit
    // accidentally agrees with best-fit for cars (C sorts before L) but diverges
    // for bikes, because 'C' sorts before 'M'. It quietly eats car-sized bays.
    const spots = [
      spot('1', 1, 'F1-M01', SpotType.MOTORCYCLE),
      spot('2', 1, 'F1-C01', SpotType.COMPACT),
    ];

    expect(codes(firstFit.rankCandidates(spots, VehicleType.MOTORCYCLE))).toEqual(['F1-C01', 'F1-M01']);
    expect(codes(bestFit.rankCandidates(spots, VehicleType.MOTORCYCLE))).toEqual(['F1-M01', 'F1-C01']);
  });
});
