import { describe, expect, it } from 'vitest';
import { ParkingError } from '../src/domain/errors.js';
import { PaymentMethod, PaymentStatus, VehicleType } from '../src/domain/types.js';
import type { Payment } from '../src/domain/payment.js';
import type { PaymentRepository } from '../src/ports/repositories.js';
import { ParkingService } from '../src/service/parkingService.js';
import { BestFitAllocationStrategy } from '../src/allocation/allocationStrategy.js';
import { HourlyFeeCalculator, PricingTable } from '../src/pricing/feeCalculator.js';
import { FixedClock } from '../src/ports/clock.js';
import { SequentialIdGenerator } from '../src/ports/ids.js';
import {
  InMemoryPaymentRepository,
  InMemoryTicketRepository,
  InMemoryVehicleRepository,
} from '../src/infra/inMemoryRepositories.js';
import { seedSpots } from './support/harness.js';

/** Lets the first payment write fail, the way a flaky gateway would. */
class PaymentRepositoryFailingOnce implements PaymentRepository {
  private shouldFail = true;

  constructor(private readonly inner: InMemoryPaymentRepository) {}

  insert(payment: Payment): void {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new ParkingError('gateway unreachable', 'PAYMENT_GATEWAY_DOWN');
    }
    this.inner.insert(payment);
  }

  findByTicket(ticketId: string): Payment | null {
    return this.inner.findByTicket(ticketId);
  }

  findByIdempotencyKey(key: string): Payment | null {
    return this.inner.findByIdempotencyKey(key);
  }
}

describe('when payment fails after the ticket is closed', () => {
  it('keeps the spot free and completes the payment on a retry', () => {
    const ids = new SequentialIdGenerator('id');
    const spots = seedSpots([{ floorNumber: 1, compact: 2 }]);
    const tickets = new InMemoryTicketRepository();
    const payments = new InMemoryPaymentRepository();
    const clock = new FixedClock('2026-03-02T10:00:00.000Z');

    const service = new ParkingService({
      spots,
      tickets,
      vehicles: new InMemoryVehicleRepository(ids),
      payments: new PaymentRepositoryFailingOnce(payments),
      pricing: new HourlyFeeCalculator(new PricingTable()),
      allocation: new BestFitAllocationStrategy(),
      clock,
      ids,
    });

    const ticket = service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });
    clock.advanceMinutes(90);

    expect(() => service.checkOut({ ticketId: ticket.id, method: PaymentMethod.UPI }))
      .toThrowError(expect.objectContaining({ code: 'PAYMENT_GATEWAY_DOWN' }));

    // The exit itself went through, so the bay must not stay occupied.
    expect(spots.availability().free).toBe(2);

    const receipt = service.checkOut({ ticketId: ticket.id, method: PaymentMethod.UPI });

    expect(receipt.amount.paise).toBe(6000);
    expect(receipt.billedHours).toBe(2);
    expect(payments.findByTicket(ticket.id)?.status).toBe(PaymentStatus.SUCCESS);

    // And a third call is still the same receipt, not a third charge.
    expect(service.checkOut({ ticketId: ticket.id, method: PaymentMethod.UPI })).toEqual(receipt);
  });
});
