import { describe, expect, it } from 'vitest';
import { ParkingService } from '../src/service/parkingService.js';
import { BestFitAllocationStrategy } from '../src/allocation/allocationStrategy.js';
import { HourlyFeeCalculator, PricingTable } from '../src/pricing/feeCalculator.js';
import { FixedClock } from '../src/ports/clock.js';
import { SequentialIdGenerator } from '../src/ports/ids.js';
import { ParkingError } from '../src/domain/errors.js';
import { LicensePlate } from '../src/domain/licensePlate.js';
import { Ticket } from '../src/domain/ticket.js';
import { PaymentMethod, VehicleType } from '../src/domain/types.js';
import type { ParkingSpot } from '../src/domain/parkingSpot.js';
import type { Money } from '../src/domain/money.js';
import type {
  PaymentRepository,
  SpotRepository,
  TicketRepository,
  VehicleRepository,
} from '../src/ports/repositories.js';
import {
  InMemoryPaymentRepository,
  InMemorySpotRepository,
  InMemoryTicketRepository,
  InMemoryVehicleRepository,
} from '../src/infra/inMemoryRepositories.js';
import { makeHarness, seedSpots } from './support/harness.js';

/**
 * These tests describe the failure modes I expect once this runs against a real
 * database, where "check then insert" is no longer atomic. The in-memory repo is
 * synchronous, so I used small decorators to force a lost race on purpose.
 */

class SpotRepositoryLosingOneRace implements SpotRepository {
  private riggedSpotId: string | null;

  constructor(
    private readonly inner: InMemorySpotRepository,
    spotId: string,
  ) {
    this.riggedSpotId = spotId;
  }

  add(spot: ParkingSpot): void {
    this.inner.add(spot);
  }

  findById(id: string): ParkingSpot | null {
    return this.inner.findById(id);
  }

  all(): ParkingSpot[] {
    return this.inner.all();
  }

  tryMarkOccupied(id: string): boolean {
    // Pretend another request claimed this spot between rank and claim.
    if (id === this.riggedSpotId) {
      this.riggedSpotId = null;
      return false;
    }
    return this.inner.tryMarkOccupied(id);
  }

  markAvailable(id: string): void {
    this.inner.markAvailable(id);
  }

  markOutOfService(id: string): void {
    this.inner.markOutOfService(id);
  }

  availability() {
    return this.inner.availability();
  }
}

class TicketRepositoryFailingOnce implements TicketRepository {
  private shouldFail = true;

  constructor(private readonly inner: InMemoryTicketRepository) {}

  insert(ticket: Ticket): void {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new ParkingError('simulated insert failure', 'SIMULATED_FAILURE');
    }
    this.inner.insert(ticket);
  }

  findById(id: string): Ticket | null {
    return this.inner.findById(id);
  }

  findActiveByPlate(plate: Parameters<TicketRepository['findActiveByPlate']>[0]) {
    return this.inner.findActiveByPlate(plate);
  }

  findActiveBySpot(spotId: string): Ticket | null {
    return this.inner.findActiveBySpot(spotId);
  }

  tryClose(id: string, exitAt: Date, billedHours: number, amount: Money): boolean {
    return this.inner.tryClose(id, exitAt, billedHours, amount);
  }

  all(): Ticket[] {
    return this.inner.all();
  }
}

interface Wiring {
  spots: InMemorySpotRepository;
  tickets: InMemoryTicketRepository;
  vehicles: InMemoryVehicleRepository;
  payments: InMemoryPaymentRepository;
  ids: SequentialIdGenerator;
  clock: FixedClock;
}

function wiring(spotCount = 2): Wiring {
  const ids = new SequentialIdGenerator('id');
  return {
    spots: seedSpots([{ floorNumber: 1, compact: spotCount }]),
    tickets: new InMemoryTicketRepository(),
    vehicles: new InMemoryVehicleRepository(ids),
    payments: new InMemoryPaymentRepository(),
    ids,
    clock: new FixedClock('2026-03-02T10:00:00.000Z'),
  };
}

function serviceWith(deps: Wiring, overrides: Partial<{ spots: SpotRepository; tickets: TicketRepository }> = {}) {
  const spots = overrides.spots ?? deps.spots;
  const tickets = overrides.tickets ?? deps.tickets;

  return new ParkingService({
    spots,
    tickets,
    vehicles: deps.vehicles as VehicleRepository,
    payments: deps.payments as PaymentRepository,
    pricing: new HourlyFeeCalculator(new PricingTable()),
    allocation: new BestFitAllocationStrategy(),
    clock: deps.clock,
    ids: deps.ids,
  });
}

describe('many cars arriving at once', () => {
  it('never books the same spot twice and never exceeds capacity', async () => {
    const { service, spots } = makeHarness({ floors: [{ floorNumber: 1, compact: 50 }] });

    const results = await Promise.allSettled(
      Array.from({ length: 200 }, (_, i) =>
        Promise.resolve().then(() =>
          service.checkIn({ plate: `KA01AB${String(i).padStart(4, '0')}`, vehicleType: VehicleType.CAR }),
        ),
      ),
    );

    const ok = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter((result) => result.status === 'rejected');

    expect(ok).toHaveLength(50);
    expect(failed).toHaveLength(150);
    expect(spots.availability().free).toBe(0);

    const bookedSpots = ok.map((result) => (result as PromiseFulfilledResult<Ticket>).value.spotId);
    expect(new Set(bookedSpots).size).toBe(50);

    for (const failure of failed) {
      const reason = (failure as PromiseRejectedResult).reason as ParkingError;
      expect(reason.code).toBe('LOT_FULL');
    }
  });

  it('lets only one of two simultaneous entries for the same plate through', async () => {
    const { service } = makeHarness({ floors: [{ floorNumber: 1, compact: 5 }] });

    const results = await Promise.allSettled([
      Promise.resolve().then(() => service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR })),
      Promise.resolve().then(() => service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR })),
    ]);

    const ok = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter((result) => result.status === 'rejected');

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(((failed[0] as PromiseRejectedResult).reason as ParkingError).code).toBe('ALREADY_PARKED');
  });
});

describe('losing a claim race', () => {
  it('moves on to the next candidate instead of reporting a full lot', () => {
    const deps = wiring(2);
    const firstChoice = deps.spots.all()[0];
    if (!firstChoice) throw new Error('fixture is broken');

    const service = serviceWith(deps, {
      spots: new SpotRepositoryLosingOneRace(deps.spots, firstChoice.id),
    });

    const ticket = service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });

    expect(ticket.spotId).not.toBe(firstChoice.id);
    expect(deps.spots.findById(ticket.spotId)?.status).toBe('OCCUPIED');
  });

  it('releases the spot when the ticket write fails, so it is not leaked', () => {
    const deps = wiring(1);
    const service = serviceWith(deps, {
      tickets: new TicketRepositoryFailingOnce(deps.tickets),
    });

    expect(() => service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR }))
      .toThrowError(expect.objectContaining({ code: 'SIMULATED_FAILURE' }));

    const spot = deps.spots.all()[0];
    expect(spot?.status).toBe('AVAILABLE');
    expect(deps.spots.availability().free).toBe(1);
  });

  it('two exits racing for one spot: only one close wins', () => {
    const { service, clock } = makeHarness({ floors: [{ floorNumber: 1, compact: 1 }] });
    const ticket = service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });
    clock.advanceMinutes(90);

    // Both reads see an ACTIVE ticket; only the conditional close may win.
    const first = service.checkOut({ ticketId: ticket.id, method: PaymentMethod.CASH });
    const second = service.checkOut({ ticketId: ticket.id, method: PaymentMethod.CASH });

    expect(second).toEqual(first);
    expect(service.availability().free).toBe(1);
  });

  it('the repository refuses a second active ticket for the same spot', () => {
    const deps = wiring(1);
    const service = serviceWith(deps);
    const ticket = service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });

    // Bypass the service, the way a buggy retry or a second process would.
    const otherVehicle = deps.vehicles.upsert(LicensePlate.of('KA01XY9999'), VehicleType.CAR);
    const rogue = Ticket.open({
      id: 'rogue',
      vehicle: otherVehicle,
      spotId: ticket.spotId,
      entryAt: deps.clock.now(),
    });

    expect(() => deps.tickets.insert(rogue)).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_ACTIVE_TICKET' }),
    );
  });
});
