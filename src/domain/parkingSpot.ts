import { SpotUnavailableError } from './errors.js';
import { SPOT_CAPACITY, SpotStatus, type SpotType } from './types.js';

/**
 * Status changes go through methods rather than a public setter, so the legal
 * transitions are visible in one place:
 *
 *   AVAILABLE -> OCCUPIED -> AVAILABLE
 *   AVAILABLE -> OUT_OF_SERVICE -> AVAILABLE
 *
 * OCCUPIED -> OUT_OF_SERVICE is refused on purpose; take the car out first.
 */
export class ParkingSpot {
  private currentStatus: SpotStatus;

  constructor(
    readonly id: string,
    readonly floorNumber: number,
    readonly code: string,
    readonly type: SpotType,
    status: SpotStatus = SpotStatus.AVAILABLE,
  ) {
    this.currentStatus = status;
  }

  get status(): SpotStatus {
    return this.currentStatus;
  }

  get capacity(): number {
    return SPOT_CAPACITY[this.type];
  }

  get isFree(): boolean {
    return this.currentStatus === SpotStatus.AVAILABLE;
  }

  occupy(): void {
    if (!this.isFree) throw new SpotUnavailableError(this.id);
    this.currentStatus = SpotStatus.OCCUPIED;
  }

  release(): void {
    if (this.currentStatus !== SpotStatus.OCCUPIED) throw new SpotUnavailableError(this.id);
    this.currentStatus = SpotStatus.AVAILABLE;
  }

  takeOutOfService(): void {
    if (this.currentStatus === SpotStatus.OCCUPIED) throw new SpotUnavailableError(this.id);
    this.currentStatus = SpotStatus.OUT_OF_SERVICE;
  }

  restore(): void {
    this.currentStatus = SpotStatus.AVAILABLE;
  }
}
