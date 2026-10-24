import { Money } from '../domain/money.js';
import type { Ticket } from '../domain/ticket.js';
import { VehicleType } from '../domain/types.js';

export interface PricingRule {
  vehicleType: VehicleType;
  hourlyPaise: number;
  /** null = no cap. */
  dailyCapPaise: number | null;
  graceMinutes: number;
}

export const DEFAULT_PRICING: readonly PricingRule[] = [
  { vehicleType: VehicleType.MOTORCYCLE, hourlyPaise: 1_000, dailyCapPaise: 10_000, graceMinutes: 0 },
  { vehicleType: VehicleType.CAR, hourlyPaise: 3_000, dailyCapPaise: 30_000, graceMinutes: 0 },
  { vehicleType: VehicleType.BUS, hourlyPaise: 6_000, dailyCapPaise: 60_000, graceMinutes: 0 },
];

/** Config table, mirroring the pricing_rules table in schema.sql. */
export class PricingTable {
  private readonly rules = new Map<VehicleType, PricingRule>();

  constructor(rules: readonly PricingRule[] = DEFAULT_PRICING) {
    for (const rule of rules) this.rules.set(rule.vehicleType, rule);
  }

  forType(type: VehicleType): PricingRule {
    const rule = this.rules.get(type);
    if (!rule) throw new Error(`No pricing rule for ${type}`);
    return rule;
  }
}

export interface FeeResult {
  amount: Money;
  billedHours: number;
}

export interface FeeCalculator {
  calculate(ticket: Ticket, exitAt: Date): FeeResult;
}

/**
 * Hourly billing with a daily cap.
 *
 * Rounds *up* to a started hour with a one hour minimum: a 61 minute stay is
 * two hours. The cap is applied per full 24h block, then the leftover hours are
 * charged at the hourly rate, so a 25h stay is 1 day + 1 hour rather than
 * 25 x hourly.
 */
export class HourlyFeeCalculator implements FeeCalculator {
  constructor(private readonly pricing: PricingTable) {}

  calculate(ticket: Ticket, exitAt: Date): FeeResult {
    // Clamped: a bad clock or a forged exit time must not produce a negative bill.
    const minutes = Math.max(0, (exitAt.getTime() - ticket.entryAt.getTime()) / 60_000);
    const rule = this.pricing.forType(ticket.vehicle.type);

    if (minutes <= rule.graceMinutes) {
      return { amount: Money.zero(), billedHours: 0 };
    }

    const billedHours = Math.max(1, Math.ceil(minutes / 60));
    const hourly = Money.of(rule.hourlyPaise);

    if (rule.dailyCapPaise === null) {
      return { amount: hourly.times(billedHours), billedHours };
    }

    const fullDays = Math.floor(billedHours / 24);
    const leftoverHours = billedHours % 24;
    const amount = Money.of(rule.dailyCapPaise).times(fullDays).plus(hourly.times(leftoverHours));

    return { amount, billedHours };
  }
}
