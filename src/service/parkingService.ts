import type { AllocationStrategy } from '../allocation/allocationStrategy.js';
import {
  AlreadyParkedError,
  LotFullError,
  ParkingError,
  UnknownTicketError,
} from '../domain/errors.js';
import { LicensePlate } from '../domain/licensePlate.js';
import { Payment } from '../domain/payment.js';
import { Ticket } from '../domain/ticket.js';
import type { PaymentMethod, VehicleType } from '../domain/types.js';
import type { FeeCalculator } from '../pricing/feeCalculator.js';
import type { AvailabilitySnapshot } from '../ports/availability.js';
import type { Clock } from '../ports/clock.js';
import type { EventPublisher } from '../ports/events.js';
import type { IdGenerator } from '../ports/ids.js';
import type {
  PaymentRepository,
  Receipt,
  SpotRepository,
  TicketRepository,
  VehicleRepository,
} from '../ports/repositories.js';
export interface ParkingServiceDeps {
  spots: SpotRepository;
  tickets: TicketRepository;
  vehicles: VehicleRepository;
  payments: PaymentRepository;
  pricing: FeeCalculator;
  allocation: AllocationStrategy;
  clock: Clock;
  ids: IdGenerator;
  events?: EventPublisher;
}

export interface CheckInCommand {
  plate: string;
  vehicleType: VehicleType;
}

export interface CheckOutCommand {
  ticketId: string;
  method: PaymentMethod;
}

/**
 * Orchestration. Business rules live in the domain or in the policy objects;
 * this class sequences them and owns the all-or-nothing boundary.
 *
 * The method bodies are synchronous, so nothing interleaves inside them in
 * Node. Cross-process safety is in the ports (tryMarkOccupied, tryClose) and in
 * the partial unique indexes. See docs/DESIGN.md section 5.
 */
export class ParkingService {
  constructor(private readonly deps: ParkingServiceDeps) {}

  checkIn(command: CheckInCommand): Ticket {
    const plate = LicensePlate.of(command.plate);

    if (this.deps.tickets.findActiveByPlate(plate)) {
      throw new AlreadyParkedError(plate.value);
    }

    const vehicle = this.deps.vehicles.upsert(plate, command.vehicleType);
    const candidates = this.deps.allocation.rankCandidates(this.deps.spots.all(), vehicle.type);

    for (const candidate of candidates) {
      // A failed claim means this particular spot is gone, not that the lot is
      // full - so keep walking down the ranked list.
      if (!this.deps.spots.tryMarkOccupied(candidate.id)) continue;

      try {
        const ticket = Ticket.open({
          id: this.deps.ids.next(),
          vehicle,
          spotId: candidate.id,
          entryAt: this.deps.clock.now(),
        });
        this.deps.tickets.insert(ticket);
        this.publishAvailability();
        return ticket;
      } catch (error) {
        // Compensation: without this, a failed insert leaves the spot OCCUPIED
        // forever. In SQL the transaction rollback does this for us.
        this.deps.spots.markAvailable(candidate.id);
        throw error;
      }
    }

    throw new LotFullError(vehicle.type);
  }

  checkOut(command: CheckOutCommand): Receipt {
    const ticket = this.deps.tickets.findById(command.ticketId);
    if (!ticket) throw new UnknownTicketError(command.ticketId);

    // Already closed: either a retried checkout or a crash between close and
    // payment. Re-settling is safe because the payment key is idempotent, and
    // it recovers the second case instead of leaving the ticket unpaid.
    if (!ticket.isActive) {
      const closedAt = ticket.exitAt ?? this.deps.clock.now();
      return this.settle(ticket, command.method, closedAt);
    }

    const exitAt = this.deps.clock.now();
    const fee = this.deps.pricing.calculate(ticket, exitAt);

    const closed = this.deps.tickets.tryClose(ticket.id, exitAt, fee.billedHours, fee.amount);
    if (!closed) {
      // Lost the race against another exit call; report the winner's numbers.
      const current = this.deps.tickets.findById(ticket.id);
      if (!current) throw new UnknownTicketError(ticket.id);
      return this.settle(current, command.method, current.exitAt ?? exitAt);
    }

    // Free the spot regardless of payment outcome - a stuck payment must not
    // hold a bay hostage.
    this.deps.spots.markAvailable(ticket.spotId);
    this.publishAvailability();

    return this.settle(ticket, command.method, exitAt);
  }

  availability(): AvailabilitySnapshot {
    return this.deps.spots.availability();
  }

  markSpotOutOfService(spotId: string): void {
    this.deps.spots.markOutOfService(spotId);
    this.publishAvailability();
  }

  private settle(ticket: Ticket, method: PaymentMethod, at: Date): Receipt {
    const idempotencyKey = `${ticket.id}:settlement`;
    const existing = this.deps.payments.findByIdempotencyKey(idempotencyKey);
    if (existing) return this.buildReceipt(ticket, existing);

    const amount = ticket.amount;
    if (!amount) throw new ParkingError(`Ticket ${ticket.id} has no amount`, 'TICKET_NOT_PRICED');

    const payment = Payment.pending({
      id: this.deps.ids.next(),
      ticketId: ticket.id,
      amount,
      method,
      idempotencyKey,
    });
    payment.markSuccess(at);
    this.deps.payments.insert(payment);

    return this.buildReceipt(ticket, payment);
  }

  private buildReceipt(ticket: Ticket, payment: Payment): Receipt {
    const spot = this.deps.spots.findById(ticket.spotId);
    const amount = ticket.amount;
    const exitAt = ticket.exitAt;
    const billedHours = ticket.billedHours;

    if (!amount || !exitAt || billedHours === null) {
      throw new ParkingError(`Ticket ${ticket.id} is not closed`, 'TICKET_NOT_CLOSED');
    }

    return {
      ticketId: ticket.id,
      plate: ticket.vehicle.plate.value,
      spotCode: spot ? spot.code : ticket.spotId,
      entryAt: ticket.entryAt,
      exitAt,
      billedHours,
      amount,
      paymentId: payment.id,
      method: payment.method,
    };
  }

  private publishAvailability(): void {
    this.deps.events?.publish({
      type: 'availability-changed',
      snapshot: this.deps.spots.availability(),
    });
  }
}
