import type { Money } from './money.js';
import { PaymentMethod, PaymentStatus } from './types.js';

interface PaymentProps {
  id: string;
  ticketId: string;
  amount: Money;
  method: PaymentMethod;
  idempotencyKey: string;
}

/**
 * In a real deployment the gateway callback flips PENDING -> SUCCESS. Here the
 * service completes it immediately, but the status field is kept so the
 * two-step flow does not have to be redesigned later.
 */
export class Payment {
  private constructor(
    readonly id: string,
    readonly ticketId: string,
    readonly amount: Money,
    readonly method: PaymentMethod,
    readonly idempotencyKey: string,
    private currentStatus: PaymentStatus,
    private settledAt: Date | null,
  ) {}

  static pending(props: PaymentProps): Payment {
    return new Payment(
      props.id,
      props.ticketId,
      props.amount,
      props.method,
      props.idempotencyKey,
      PaymentStatus.PENDING,
      null,
    );
  }

  get status(): PaymentStatus {
    return this.currentStatus;
  }

  get paidAt(): Date | null {
    return this.settledAt;
  }

  markSuccess(at: Date): void {
    this.currentStatus = PaymentStatus.SUCCESS;
    this.settledAt = at;
  }

  markFailed(): void {
    this.currentStatus = PaymentStatus.FAILED;
  }
}
