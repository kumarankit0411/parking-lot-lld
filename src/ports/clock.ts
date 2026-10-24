export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Test clock. Kept in src/ because the service tests are the main users. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(start: string | Date) {
    this.current = typeof start === 'string' ? new Date(start) : new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  set(at: string | Date): void {
    this.current = typeof at === 'string' ? new Date(at) : new Date(at.getTime());
  }
}
