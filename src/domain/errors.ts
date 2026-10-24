/**
 * Errors carry a stable `code` so the HTTP layer can map them to status codes
 * with a lookup instead of instanceof checks.
 */

export class ParkingError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class LotFullError extends ParkingError {
  constructor(vehicleType: string) {
    super(`No free spot can take a ${vehicleType} right now`, 'LOT_FULL');
  }
}

export class AlreadyParkedError extends ParkingError {
  constructor(plate: string) {
    super(`Vehicle ${plate} already has an open ticket`, 'ALREADY_PARKED');
  }
}

/**
 * Thrown by the ticket repository. This is the in-memory stand-in for the two
 * partial unique indexes in schema.sql, so the same rule is enforced whether or
 * not the caller remembered to check first.
 */
export class DuplicateActiveTicketError extends ParkingError {
  constructor(reason: 'spot' | 'vehicle', value: string) {
    super(`An active ticket already exists for ${reason} ${value}`, 'DUPLICATE_ACTIVE_TICKET');
  }
}

export class SpotUnavailableError extends ParkingError {
  constructor(spotId: string) {
    super(`Spot ${spotId} is not available`, 'SPOT_UNAVAILABLE');
  }
}

export class TicketNotActiveError extends ParkingError {
  constructor(ticketId: string) {
    super(`Ticket ${ticketId} is already closed`, 'TICKET_NOT_ACTIVE');
  }
}

export class UnknownTicketError extends ParkingError {
  constructor(ticketId: string) {
    super(`Ticket ${ticketId} does not exist`, 'UNKNOWN_TICKET');
  }
}

export class UnknownSpotError extends ParkingError {
  constructor(spotId: string) {
    super(`Spot ${spotId} does not exist`, 'UNKNOWN_SPOT');
  }
}

/**
 * The plate is already registered against a different vehicle class. I chose to
 * reject rather than silently trust either value: silently overwriting the
 * registry means billing history for that plate gets mixed between two cars.
 */
export class VehicleTypeMismatchError extends ParkingError {
  constructor(plate: string, registered: string, incoming: string) {
    super(
      `Plate ${plate} is registered as ${registered}, but check-in said ${incoming}`,
      'VEHICLE_TYPE_MISMATCH',
    );
  }
}
