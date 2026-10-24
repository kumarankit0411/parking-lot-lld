import type { AvailabilitySnapshot } from './availability.js';

export interface AvailabilityChangedEvent {
  type: 'availability-changed';
  snapshot: AvailabilitySnapshot;
}

export type ParkingEvent = AvailabilityChangedEvent;

/**
 * Stand-in for the WebSocket/SSE fan-out the "real time availability" bullet
 * implies. Keeping it as an interface means the service does not know or care
 * how the snapshot leaves the process.
 */
export interface EventPublisher {
  publish(event: ParkingEvent): void;
  subscribe(listener: (event: ParkingEvent) => void): () => void;
}

export class InMemoryEventPublisher implements EventPublisher {
  private readonly listeners = new Set<(event: ParkingEvent) => void>();

  publish(event: ParkingEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  subscribe(listener: (event: ParkingEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
