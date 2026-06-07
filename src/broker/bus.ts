import type { Message } from "../a2a/index.ts";

/** Publish a recorded message to subscribers. Async so a future network-backed
 * bus (Kafka, Google Pub/Sub) is a new implementation, never an interface change. */
export interface MessagePublisher {
  publish(message: Message): Promise<void>;
}

/** Subscribe to recorded messages; returns an unsubscribe handle. */
export interface MessageSubscriber {
  subscribe(listener: (message: Message) => void): () => void;
}

/**
 * In-process fan-out of recorded messages. The broker publishes each message it
 * records; observers (dashboard SSE, task projector, sweep policies) subscribe.
 * Purely observational — carries no control authority. The default `bus.kind`.
 *
 * Adapter contract for alternative buses: MAY deliver at-least-once, out-of-order,
 * and asynchronously; subscribers MUST be idempotent and tolerate duplicates
 * (satisfied here by the task projector and the peek/ack watermark).
 */
export class MemoryBus implements MessagePublisher, MessageSubscriber {
  private listeners = new Set<(message: Message) => void>();

  async publish(message: Message): Promise<void> {
    for (const listener of [...this.listeners]) listener(message);
  }

  subscribe(listener: (message: Message) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
