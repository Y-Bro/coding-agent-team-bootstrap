import type { Message } from "../a2a/index.ts";

/** Publish a recorded message to subscribers (broker → dashboard live feed). */
export interface MessagePublisher {
  publish(message: Message): void;
}

/** Subscribe to recorded messages; returns an unsubscribe handle. */
export interface MessageSubscriber {
  subscribe(listener: (message: Message) => void): () => void;
}

/**
 * In-process fan-out of recorded messages (v3-m4 read-only dashboard). The broker
 * publishes each message it records; the dashboard SSE endpoint subscribes to
 * push live updates. Purely observational — it carries no control authority.
 */
export class MessageBus implements MessagePublisher, MessageSubscriber {
  private listeners = new Set<(message: Message) => void>();

  publish(message: Message): void {
    for (const listener of [...this.listeners]) listener(message);
  }

  subscribe(listener: (message: Message) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
