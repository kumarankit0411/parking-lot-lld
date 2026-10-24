/**
 * Plates are the natural key for a vehicle, so they get normalised once at the
 * boundary. Without this, "KA 01 AB 1234" and "ka01ab1234" become two vehicles.
 */
export class LicensePlate {
  private constructor(readonly value: string) {}

  static of(raw: string): LicensePlate {
    const cleaned = raw.replace(/[\s-]/g, '').toUpperCase();
    if (cleaned.length < 4 || cleaned.length > 12) {
      throw new Error(`'${raw}' does not look like a licence plate`);
    }
    return new LicensePlate(cleaned);
  }

  equals(other: LicensePlate): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
