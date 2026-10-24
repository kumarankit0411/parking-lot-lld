import { describe, expect, it } from 'vitest';
import { LicensePlate } from '../src/domain/licensePlate.js';
import { PaymentMethod, VehicleType } from '../src/domain/types.js';
import { makeHarness, spotByCode } from './support/harness.js';

describe('check-in', () => {
  it('gives a car the smallest compact spot on the closest floor', () => {
    const { service, spots } = makeHarness();

    const ticket = service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });

    expect(spotByCode(spots, 'F1-C01').status).toBe('OCCUPIED');
    expect(ticket.spotId).toBe(spotByCode(spots, 'F1-C01').id);
    expect(ticket.isActive).toBe(true);
  });

  it('frees exactly one unit of availability', () => {
    const { service } = makeHarness();
    const before = service.availability();

    service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });

    const after = service.availability();
    expect(after.free).toBe(before.free - 1);
    expect(after.total).toBe(before.total);
  });

  it('normalises the plate so spacing and case do not create a second vehicle', () => {
    const { service, vehicles } = makeHarness();

    service.checkIn({ plate: 'ka 01 ab 1234', vehicleType: VehicleType.CAR });

    expect(vehicles.findByPlate(LicensePlate.of('KA01AB1234'))).not.toBeNull();
    expect(() => service.checkIn({ plate: 'KA01-AB-1234', vehicleType: VehicleType.CAR }))
      .toThrowError(/already has an open ticket/);
  });

  it('rejects a second entry for the same plate', () => {
    const { service } = makeHarness();
    service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });

    expect(() => service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR }))
      .toThrowError(expect.objectContaining({ code: 'ALREADY_PARKED' }));
  });

  it('rejects a plate that is already registered as a different vehicle class', () => {
    const { service, clock } = makeHarness();
    const ticket = service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });
    clock.advanceMinutes(30);
    service.checkOut({ ticketId: ticket.id, method: PaymentMethod.UPI });

    expect(() => service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.MOTORCYCLE }))
      .toThrowError(expect.objectContaining({ code: 'VEHICLE_TYPE_MISMATCH' }));
  });

  it('says the lot is full when nothing can take the vehicle', () => {
    const { service } = makeHarness({
      floors: [{ floorNumber: 1, compact: 1, large: 0 }],
    });
    service.checkIn({ plate: 'KA01AB0001', vehicleType: VehicleType.CAR });

    expect(() => service.checkIn({ plate: 'KA01AB0002', vehicleType: VehicleType.CAR }))
      .toThrowError(expect.objectContaining({ code: 'LOT_FULL' }));
  });

  it('does not hand out a spot that is out of service', () => {
    const { service, spots } = makeHarness({ floors: [{ floorNumber: 1, compact: 1, large: 0 }] });
    spotByCode(spots, 'F1-C01').takeOutOfService();

    expect(() => service.checkIn({ plate: 'KA01AB0001', vehicleType: VehicleType.CAR }))
      .toThrowError(expect.objectContaining({ code: 'LOT_FULL' }));
  });

  it('publishes an availability snapshot after a successful entry', () => {
    const { service, events } = makeHarness();
    const seen: number[] = [];
    events.subscribe((event) => seen.push(event.snapshot.free));

    service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(service.availability().free);
  });
});

describe('check-out', () => {
  it('bills the stay, frees the spot and records one payment', () => {
    const { service, clock, spots } = makeHarness();
    const ticket = service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });

    clock.advanceMinutes(135);
    const receipt = service.checkOut({ ticketId: ticket.id, method: PaymentMethod.UPI });

    expect(receipt.billedHours).toBe(3);
    expect(receipt.amount.format()).toBe('₹90.00');
    expect(receipt.spotCode).toBe('F1-C01');
    expect(spotByCode(spots, 'F1-C01').status).toBe('AVAILABLE');
    expect(ticket.isActive).toBe(false);
  });

  it('is idempotent: a retried checkout does not charge twice', () => {
    const { service, clock } = makeHarness();
    const ticket = service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });
    clock.advanceMinutes(60);

    const first = service.checkOut({ ticketId: ticket.id, method: PaymentMethod.CARD });
    clock.advanceMinutes(45);
    const second = service.checkOut({ ticketId: ticket.id, method: PaymentMethod.CARD });

    expect(second).toEqual(first);
    expect(second.amount.paise).toBe(3000);
  });

  it('lets the same plate back in after it leaves', () => {
    const { service, clock, vehicles } = makeHarness();
    const first = service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });
    clock.advanceMinutes(30);
    service.checkOut({ ticketId: first.id, method: PaymentMethod.CASH });

    const second = service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });

    expect(second.id).not.toBe(first.id);
    expect(second.vehicle.id).toBe(first.vehicle.id);
    expect(vehicles.findByPlate(second.vehicle.plate)?.id).toBe(first.vehicle.id);
  });

  it('rejects an unknown ticket', () => {
    const { service } = makeHarness();

    expect(() => service.checkOut({ ticketId: 'nope', method: PaymentMethod.CASH }))
      .toThrowError(expect.objectContaining({ code: 'UNKNOWN_TICKET' }));
  });

  it('keeps the spot free even if the lot is otherwise full afterwards', () => {
    const { service, clock, spots } = makeHarness({ floors: [{ floorNumber: 1, compact: 1 }] });
    const ticket = service.checkIn({ plate: 'KA01AB1234', vehicleType: VehicleType.CAR });
    clock.advanceMinutes(20);
    service.checkOut({ ticketId: ticket.id, method: PaymentMethod.CASH });

    expect(spots.availability().free).toBe(1);
    expect(() => service.checkIn({ plate: 'KA01AB9999', vehicleType: VehicleType.CAR })).not.toThrow();
  });
});

describe('availability reporting', () => {
  it('groups free and total per floor and spot type', () => {
    const { service } = makeHarness({
      floors: [
        { floorNumber: 1, motorcycle: 2, compact: 2, large: 1 },
        { floorNumber: 2, compact: 1 },
      ],
    });

    const snapshot = service.availability();

    expect(snapshot.total).toBe(6);
    expect(snapshot.free).toBe(6);
    expect(snapshot.lines).toEqual([
      { floorNumber: 1, spotType: 'MOTORCYCLE', free: 2, total: 2 },
      { floorNumber: 1, spotType: 'COMPACT', free: 2, total: 2 },
      { floorNumber: 1, spotType: 'LARGE', free: 1, total: 1 },
      { floorNumber: 2, spotType: 'COMPACT', free: 1, total: 1 },
    ]);
  });
});
