import { ParkingSpot } from '../domain/parkingSpot.js';
import {
  DuplicateActiveTicketError,
  ParkingError,
  UnknownSpotError,
  VehicleTypeMismatchError,
} from '../domain/errors.js';
import { LicensePlate } from '../domain/licensePlate.js';
import type { Money } from '../domain/money.js';
import { PaymentStatus, SPOT_CAPACITY, VehicleType } from '../domain/types.js';
import type { Payment } from '../domain/payment.js';
import type { Ticket } from '../domain/ticket.js';
import { Vehicle } from '../domain/vehicle.js';
import type { AvailabilityLine, AvailabilitySnapshot } from '../ports/availability.js';
import type { IdGenerator } from '../ports/ids.js';
import type {
  PaymentRepository,
  SpotRepository,
  TicketRepository,
  VehicleRepository,
} from '../ports/repositories.js';

/**
 * In-memory versions of the ports, so the domain and service can run without a
 * database. schema.sql is the real design.
 *
 * The uniqueness checks in the two repositories are deliberate: they enforce
 * the same rules as the partial indexes, so the service cannot rely on a
 * check-then-act sequence that only works single-threaded.
 */

export class InMemorySpotRepository implements SpotRepository {
  private readonly spots = new Map<string, ParkingSpot>();

  add(spot: ParkingSpot): void {
    if (this.spots.has(spot.id)) throw new Error(`Duplicate spot id ${spot.id}`);
    this.spots.set(spot.id, spot);
  }

  findById(id: string): ParkingSpot | null {
    return this.spots.get(id) ?? null;
  }

  all(): ParkingSpot[] {
    return [...this.spots.values()];
  }

  tryMarkOccupied(id: string): boolean {
    const spot = this.spots.get(id);
    if (!spot || !spot.isFree) return false;
    spot.occupy();
    return true;
  }

  markAvailable(id: string): void {
    const spot = this.spots.get(id);
    if (!spot) throw new UnknownSpotError(id);
    if (spot.isFree) return;
    spot.release();
  }

  markOutOfService(id: string): void {
    const spot = this.spots.get(id);
    if (!spot) throw new UnknownSpotError(id);
    spot.takeOutOfService();
  }

  /** Derived on read, mirroring the group-by in the design doc. */
  availability(): AvailabilitySnapshot {
    const groups = new Map<string, AvailabilityLine>();
    for (const spot of this.spots.values()) {
      const key = `${spot.floorNumber}:${spot.type}`;
      const line = groups.get(key);
      if (line) {
        line.total += 1;
        if (spot.isFree) line.free += 1;
      } else {
        groups.set(key, {
          floorNumber: spot.floorNumber,
          spotType: spot.type,
          free: spot.isFree ? 1 : 0,
          total: 1,
        });
      }
    }

    const lines = [...groups.values()].sort(
      (a, b) => a.floorNumber - b.floorNumber || SPOT_CAPACITY[a.spotType] - SPOT_CAPACITY[b.spotType],
    );

    return {
      free: lines.reduce((sum, line) => sum + line.free, 0),
      total: lines.reduce((sum, line) => sum + line.total, 0),
      lines,
    };
  }
}

export class InMemoryTicketRepository implements TicketRepository {
  private readonly tickets = new Map<string, Ticket>();

  insert(ticket: Ticket): void {
    if (this.tickets.has(ticket.id)) throw new Error(`Duplicate ticket id ${ticket.id}`);

    // ux_ticket_active_spot / ux_ticket_active_vehicle, in application form.
    if (this.findActiveBySpot(ticket.spotId)) {
      throw new DuplicateActiveTicketError('spot', ticket.spotId);
    }
    if (this.findActiveByPlate(ticket.vehicle.plate)) {
      throw new DuplicateActiveTicketError('vehicle', ticket.vehicle.plate.value);
    }

    this.tickets.set(ticket.id, ticket);
  }

  findById(id: string): Ticket | null {
    return this.tickets.get(id) ?? null;
  }

  findActiveByPlate(plate: LicensePlate): Ticket | null {
    for (const ticket of this.tickets.values()) {
      if (ticket.isActive && ticket.vehicle.plate.equals(plate)) return ticket;
    }
    return null;
  }

  findActiveBySpot(spotId: string): Ticket | null {
    for (const ticket of this.tickets.values()) {
      if (ticket.isActive && ticket.spotId === spotId) return ticket;
    }
    return null;
  }

  tryClose(id: string, exitAt: Date, billedHours: number, amount: Money): boolean {
    const ticket = this.tickets.get(id);
    if (!ticket || !ticket.isActive) return false;
    ticket.close(exitAt, billedHours, amount);
    return true;
  }

  all(): Ticket[] {
    return [...this.tickets.values()];
  }
}

export class InMemoryVehicleRepository implements VehicleRepository {
  private readonly byPlate = new Map<string, Vehicle>();

  constructor(private readonly ids: IdGenerator) {}

  upsert(plate: LicensePlate, type: VehicleType): Vehicle {
    const existing = this.byPlate.get(plate.value);
    if (existing) {
      if (existing.type !== type) {
        throw new VehicleTypeMismatchError(plate.value, existing.type, type);
      }
      return existing;
    }

    const vehicle = new Vehicle(this.ids.next(), plate, type);
    this.byPlate.set(plate.value, vehicle);
    return vehicle;
  }

  findByPlate(plate: LicensePlate): Vehicle | null {
    return this.byPlate.get(plate.value) ?? null;
  }
}

export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly byId = new Map<string, Payment>();
  private readonly byIdempotencyKey = new Map<string, string>();

  insert(payment: Payment): void {
    if (this.byIdempotencyKey.has(payment.idempotencyKey)) {
      throw new ParkingError(
        `Payment with idempotency key ${payment.idempotencyKey} already exists`,
        'DUPLICATE_PAYMENT',
      );
    }

    if (payment.status === PaymentStatus.SUCCESS) {
      const settled = this.findByTicket(payment.ticketId);
      if (settled && settled.status === PaymentStatus.SUCCESS) {
        throw new ParkingError(`Ticket ${payment.ticketId} is already paid`, 'PAYMENT_ALREADY_SETTLED');
      }
    }

    this.byId.set(payment.id, payment);
    this.byIdempotencyKey.set(payment.idempotencyKey, payment.id);
  }

  findByTicket(ticketId: string): Payment | null {
    let latest: Payment | null = null;
    for (const payment of this.byId.values()) {
      if (payment.ticketId !== ticketId) continue;
      if (payment.status === PaymentStatus.SUCCESS) return payment;
      latest = payment;
    }
    return latest;
  }

  findByIdempotencyKey(key: string): Payment | null {
    const id = this.byIdempotencyKey.get(key);
    return id ? (this.byId.get(id) ?? null) : null;
  }
}
