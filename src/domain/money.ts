/**
 * Money as integer paise. Floats do not belong anywhere near a bill.
 */
export class Money {
  private constructor(readonly paise: number) {}

  static of(paise: number): Money {
    if (!Number.isInteger(paise)) throw new Error(`Money must be whole paise, got ${paise}`);
    if (paise < 0) throw new Error(`Money cannot be negative, got ${paise}`);
    return new Money(paise);
  }

  static zero(): Money {
    return new Money(0);
  }

  plus(other: Money): Money {
    return Money.of(this.paise + other.paise);
  }

  times(factor: number): Money {
    return Money.of(this.paise * factor);
  }

  equals(other: Money): boolean {
    return this.paise === other.paise;
  }

  /** ₹330.00 - display only. */
  format(): string {
    return `₹${(this.paise / 100).toFixed(2)}`;
  }
}
