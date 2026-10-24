import { describe, expect, it } from 'vitest';
import { LicensePlate } from '../src/domain/licensePlate.js';
import { Money } from '../src/domain/money.js';
import { Ticket } from '../src/domain/ticket.js';
import { Vehicle } from '../src/domain/vehicle.js';
import { VehicleType } from '../src/domain/types.js';
import {
  DEFAULT_PRICING,
  HourlyFeeCalculator,
  PricingTable,
  type PricingRule,
} from '../src/pricing/feeCalculator.js';

const calculator = new HourlyFeeCalculator(new PricingTable());

function ticketFor(type: VehicleType, entryAt: string): Ticket {
  return Ticket.open({
    id: 't1',
    vehicle: new Vehicle('v1', LicensePlate.of('KA01AB1234'), type),
    spotId: 's1',
    entryAt: new Date(entryAt),
  });
}

function feeFor(type: VehicleType, entryAt: string, exitAt: string) {
  return calculator.calculate(ticketFor(type, entryAt), new Date(exitAt));
}

describe('hourly fee calculation', () => {
  it('rounds up to a started hour: 2h15m of a car is 3 hours', () => {
    const result = feeFor(VehicleType.CAR, '2026-03-02T10:00:00Z', '2026-03-02T12:15:00Z');

    expect(result.billedHours).toBe(3);
    expect(result.amount.format()).toBe('₹90.00');
  });

  it('charges a minimum of one hour', () => {
    expect(feeFor(VehicleType.CAR, '2026-03-02T10:00:00Z', '2026-03-02T10:00:01Z').amount.paise).toBe(3000);
  });

  it('uses the vehicle rate', () => {
    expect(feeFor(VehicleType.MOTORCYCLE, '2026-03-02T10:00:00Z', '2026-03-02T12:00:00Z').amount.paise).toBe(2000);
    expect(feeFor(VehicleType.BUS, '2026-03-02T10:00:00Z', '2026-03-02T13:00:00Z').amount.paise).toBe(18_000);
  });

  it('applies the daily cap instead of multiplying hourly forever', () => {
    // 25h at ₹30/h would be ₹750. One capped day plus one hour is ₹330.
    const result = feeFor(VehicleType.CAR, '2026-03-02T10:00:00Z', '2026-03-03T11:00:00Z');

    expect(result.billedHours).toBe(25);
    expect(result.amount.format()).toBe('₹330.00');
  });

  it('charges two full capped days for a 48h stay', () => {
    const result = feeFor(VehicleType.CAR, '2026-03-02T10:00:00Z', '2026-03-04T10:00:00Z');

    expect(result.billedHours).toBe(48);
    expect(result.amount.paise).toBe(60_000);
  });

  it('honours a grace period', () => {
    const rules: PricingRule[] = [
      { vehicleType: VehicleType.CAR, hourlyPaise: 3000, dailyCapPaise: 30_000, graceMinutes: 15 },
    ];
    const withGrace = new HourlyFeeCalculator(new PricingTable(rules));
    const ticket = ticketFor(VehicleType.CAR, '2026-03-02T10:00:00Z');

    expect(withGrace.calculate(ticket, new Date('2026-03-02T10:10:00Z')).amount.paise).toBe(0);
    expect(withGrace.calculate(ticket, new Date('2026-03-02T10:16:00Z')).amount.paise).toBe(3000);
  });

  it('works without a daily cap', () => {
    const rules: PricingRule[] = [
      { vehicleType: VehicleType.CAR, hourlyPaise: 3000, dailyCapPaise: null, graceMinutes: 0 },
    ];
    const uncapped = new HourlyFeeCalculator(new PricingTable(rules));
    const ticket = ticketFor(VehicleType.CAR, '2026-03-02T10:00:00Z');

    expect(uncapped.calculate(ticket, new Date('2026-03-03T11:00:00Z')).amount.paise).toBe(75_000);
  });

  it('never goes negative when the exit time is before the entry time', () => {
    const result = feeFor(VehicleType.CAR, '2026-03-02T10:00:00Z', '2026-03-02T09:00:00Z');

    expect(result.amount.paise).toBe(0);
  });

  it('keeps DEFAULT_PRICING in sync with the rates in the design doc', () => {
    expect(DEFAULT_PRICING.map((rule) => [rule.vehicleType, rule.hourlyPaise])).toEqual([
      [VehicleType.MOTORCYCLE, 1000],
      [VehicleType.CAR, 3000],
      [VehicleType.BUS, 6000],
    ]);
  });
});

describe('money', () => {
  it('rejects floats and negatives', () => {
    expect(() => Money.of(12.5)).toThrow();
    expect(() => Money.of(-1)).toThrow();
  });

  it('formats paise as rupees', () => {
    expect(Money.of(123_450).format()).toBe('₹1234.50');
  });
});
