import { TicketNotActiveError } from './errors.js';
import type { Money } from './money.js';
import { TicketStatus } from './types.js';
import type { Vehicle } from './vehicle.js';

interface OpenTicketProps {
  id: string;
  vehicle: Vehicle;
  spotId: string;
  entryAt: Date;
}

/**
 * The record of one stay: entry, exit, and what was charged. The amount is
 * frozen at checkout so a later price change cannot rewrite an old bill.
 */
export class Ticket {
  private currentStatus: TicketStatus = TicketStatus.ACTIVE;
  private closedAt: Date | null = null;
  private hours: number | null = null;
  private charged: Money | null = null;

  private constructor(
    readonly id: string,
    readonly vehicle: Vehicle,
    readonly spotId: string,
    readonly entryAt: Date,
  ) {}

  static open(props: OpenTicketProps): Ticket {
    return new Ticket(props.id, props.vehicle, props.spotId, props.entryAt);
  }

  get status(): TicketStatus {
    return this.currentStatus;
  }

  get isActive(): boolean {
    return this.currentStatus === TicketStatus.ACTIVE;
  }

  get exitAt(): Date | null {
    return this.closedAt;
  }

  get billedHours(): number | null {
    return this.hours;
  }

  get amount(): Money | null {
    return this.charged;
  }

  close(exitAt: Date, billedHours: number, amount: Money): void {
    if (!this.isActive) throw new TicketNotActiveError(this.id);
    if (exitAt.getTime() < this.entryAt.getTime()) {
      throw new Error('Exit time cannot be before entry time');
    }
    this.closedAt = exitAt;
    this.hours = billedHours;
    this.charged = amount;
    this.currentStatus = TicketStatus.CLOSED;
  }
}
