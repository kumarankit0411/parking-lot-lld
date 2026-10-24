import { BestFitAllocationStrategy } from '../../src/allocation/allocationStrategy.js';
import { ParkingService } from '../../src/service/parkingService.js';
import { FixedClock } from '../../src/ports/clock.js';
import { InMemoryEventPublisher } from '../../src/ports/events.js';
import { SequentialIdGenerator } from '../../src/ports/ids.js';
import { HourlyFeeCalculator, PricingTable, type PricingRule } from '../../src/pricing/feeCalculator.js';
import { ParkingSpot } from '../../src/domain/parkingSpot.js';
import { SpotStatus, SpotType } from '../../src/domain/types.js';
import {
  InMemoryPaymentRepository,
  InMemorySpotRepository,
  InMemoryTicketRepository,
  InMemoryVehicleRepository,
} from '../../src/infra/inMemoryRepositories.js';

export interface FloorSeed {
  floorNumber: number;
  motorcycle?: number;
  compact?: number;
  large?: number;
}

/**
 * Builds a lot from a per-floor counts description. Codes are readable on
 * purpose ('F1-C02') so failing assertions are obvious.
 */
export function seedSpots(floors: FloorSeed[]): InMemorySpotRepository {
  const repo = new InMemorySpotRepository();
  let id = 0;

  const add = (floorNumber: number, type: SpotType, index: number) => {
    id += 1;
    const prefix = type === SpotType.MOTORCYCLE ? 'M' : type === SpotType.COMPACT ? 'C' : 'L';
    const code = `F${floorNumber}-${prefix}${String(index).padStart(2, '0')}`;
    repo.add(new ParkingSpot(`spot-${id}`, floorNumber, code, type));
  };

  for (const floor of floors) {
    for (let i = 1; i <= (floor.motorcycle ?? 0); i += 1) add(floor.floorNumber, SpotType.MOTORCYCLE, i);
    for (let i = 1; i <= (floor.compact ?? 0); i += 1) add(floor.floorNumber, SpotType.COMPACT, i);
    for (let i = 1; i <= (floor.large ?? 0); i += 1) add(floor.floorNumber, SpotType.LARGE, i);
  }

  return repo;
}

export interface Harness {
  service: ParkingService;
  spots: InMemorySpotRepository;
  tickets: InMemoryTicketRepository;
  vehicles: InMemoryVehicleRepository;
  payments: InMemoryPaymentRepository;
  clock: FixedClock;
  events: InMemoryEventPublisher;
  pricing: PricingTable;
}

export interface HarnessOptions {
  floors?: FloorSeed[];
  now?: string;
  rules?: readonly PricingRule[];
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const floors = options.floors ?? [
    { floorNumber: 1, motorcycle: 2, compact: 2, large: 1 },
    { floorNumber: 2, motorcycle: 1, compact: 2, large: 2 },
  ];

  const spots = seedSpots(floors);
  const clock = new FixedClock(options.now ?? '2026-03-02T10:00:00.000Z');
  const ids = new SequentialIdGenerator('id');
  const tickets = new InMemoryTicketRepository();
  const vehicles = new InMemoryVehicleRepository(ids);
  const payments = new InMemoryPaymentRepository();
  const pricing = new PricingTable(options.rules);
  const events = new InMemoryEventPublisher();

  const service = new ParkingService({
    spots,
    tickets,
    vehicles,
    payments,
    pricing: new HourlyFeeCalculator(pricing),
    allocation: new BestFitAllocationStrategy(),
    clock,
    ids,
    events,
  });

  return { service, spots, tickets, vehicles, payments, clock, events, pricing };
}

/** Marks a spot unusable without going through the service. */
export function blockSpot(repo: InMemorySpotRepository, code: string): void {
  const spot = repo.all().find((candidate) => candidate.code === code);
  if (!spot) throw new Error(`No spot with code ${code}`);
  spot.takeOutOfService();
}

export function spotByCode(repo: InMemorySpotRepository, code: string): ParkingSpot {
  const spot = repo.all().find((candidate) => candidate.code === code);
  if (!spot) throw new Error(`No spot with code ${code}`);
  return spot;
}

export function isOccupied(repo: InMemorySpotRepository, code: string): boolean {
  return spotByCode(repo, code).status === SpotStatus.OCCUPIED;
}
