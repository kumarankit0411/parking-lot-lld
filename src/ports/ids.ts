export interface IdGenerator {
  next(): string;
}

/** Deterministic ids. Tests read much better than random UUIDs in assertions. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix: string) {}

  next(): string {
    this.counter += 1;
    return `${this.prefix}-${String(this.counter).padStart(4, '0')}`;
  }
}
