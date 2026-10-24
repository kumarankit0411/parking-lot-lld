import type { LicensePlate } from '../domain/licensePlate.js';
import type { Money } from '../domain/money.js';
import type { ParkingSpot } from '../domain/parkingSpot.js';
import type { Payment } from '../domain/payment.js';
import type { Ticket } from '../domain/ticket.js';
import type { Vehicle } from '../domain/vehicle.js';
import type { AvailabilitySnapshot } from './availability.js';
import type { PaymentMethod, VehicleType } from '../domain/types.js';

export interface SpotRepository {
  add(spot: ParkingSpot): void;
  findById(id: string): ParkingSpot | null;
  all(): ParkingSpot[];

  /**
   * Compare-and-set, not a setter. Returning false is what tells the caller
   * "someone else got here first" - in SQL this is
   * `UPDATE ... WHERE id = ? AND status = 'AVAILABLE'` and checking the
   * affected row count.
   */
  tryMarkOccupied(id: string): boolean;

  markAvailable(id: string): void;
  markOutOfService(id: string): void;
  availability(): AvailabilitySnapshot;
}

export interface TicketRepository {
  insert(ticket: Ticket): void;
  findById(id: string): Ticket | null;
  findActiveByPlate(plate: LicensePlate): Ticket | null;
  findActiveBySpot(spotId: string): Ticket | null;
  /** Returns false when the ticket was already closed. Idempotent, not throwing. */
  tryClose(id: string, exitAt: Date, billedHours: number, amount: Money): boolean;
  all(): Ticket[];
}

export interface VehicleRepository {
  /** Inserts on first sight, otherwise returns the registered vehicle. */
  upsert(plate: LicensePlate, type: VehicleType): Vehicle;
  findByPlate(plate: LicensePlate): Vehicle | null;
}

export interface PaymentRepository {
  insert(payment: Payment): void;
  findByTicket(ticketId: string): Payment | null;
  findByIdempotencyKey(key: string): Payment | null;
}

export interface Receipt {
  ticketId: string;
  plate: string;
  spotCode: string;
  entryAt: Date;
  exitAt: Date;
  billedHours: number;
  amount: Money;
  paymentId: string;
  method: PaymentMethod;
}
