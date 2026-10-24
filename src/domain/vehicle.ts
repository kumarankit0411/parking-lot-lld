import type { LicensePlate } from './licensePlate.js';
import type { VehicleType } from './types.js';

export class Vehicle {
  constructor(
    readonly id: string,
    readonly plate: LicensePlate,
    readonly type: VehicleType,
  ) {}
}
