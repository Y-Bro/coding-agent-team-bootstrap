import type { Clock } from "../../ports/clock.ts";
import type { Sleeper } from "../../ports/sleeper.ts";
import { trace } from "../../obs/trace.ts";

/**
 * Gate for fleet-wide work: every model-triggering call goes through `run`, which
 * bounds concurrency and rate across the whole fleet. Narrow by design so callers
 * (e.g. the A2A transport) depend on the abstraction, not the implementation.
 */
export interface Scheduler {
  run<T>(agentId: string, call: () => Promise<T>): Promise<T>;
}

export interface FleetSchedulerConfig {
  /** Max calls in flight across the fleet at once. */
  maxConcurrency: number;
  /** Token-bucket burst size. */
  bucketCapacity: number;
  /** Sustained refill rate (tokens per second). */
  refillPerSec: number;
  /** First backoff after a 429 (ms). Default 1000. */
  baseBackoffMs?: number;
  /** Backoff ceiling (ms). Default 60000. */
  maxBackoffMs?: number;
  /** Retries after a 429 before giving up. Default 5. */
  maxRetries?: number;
}

/** Signals an upstream rate limit (HTTP 429); carries an optional server-supplied delay. */
export class RateLimitError extends Error {
  constructor(public readonly retryAfterMs?: number) {
    super("rate limited (429)");
    this.name = "RateLimitError";
  }
}

/** Recognize a rate-limit signal from a thrown value (RateLimitError or a 429-bearing error). */
export function isRateLimited(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  const e = err as { status?: number; code?: number } | null;
  return e != null && (e.status === 429 || e.code === 429);
}

function retryAfterOf(err: unknown): number | undefined {
  if (err instanceof RateLimitError) return err.retryAfterMs;
  return (err as { retryAfterMs?: number } | null)?.retryAfterMs;
}

interface FleetSchedulerDeps {
  clock: Clock;
  sleeper: Sleeper;
  config: FleetSchedulerConfig;
}

/**
 * Global token-bucket scheduler with adaptive backoff on 429 (LEAD DECISION Q4).
 * One instance is shared by the whole fleet so headless agent servers draw from a
 * single upstream rate-limit pool. A FIFO concurrency semaphore gives arrival-order
 * fairness across agents; the token bucket bounds sustained rate; 429s trigger
 * exponential backoff (honoring a server `retryAfterMs` when present). All timing
 * flows through the injected Clock + Sleeper, so it unit-tests with a fake clock.
 */
export class FleetScheduler implements Scheduler {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private tokens: number;
  private lastRefill: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxRetries: number;

  constructor(private deps: FleetSchedulerDeps) {
    this.tokens = deps.config.bucketCapacity;
    this.lastRefill = deps.clock.now().getTime();
    this.baseBackoffMs = deps.config.baseBackoffMs ?? 1000;
    this.maxBackoffMs = deps.config.maxBackoffMs ?? 60_000;
    this.maxRetries = deps.config.maxRetries ?? 5;
  }

  async run<T>(_agentId: string, call: () => Promise<T>): Promise<T> {
    trace("scheduler", `run for ${_agentId}: acquire slot (active=${this.active}) + token (have=${Math.floor(this.tokens)})`);
    await this.acquireSlot();
    try {
      await this.consumeToken();
      return await this.callWithBackoff(call);
    } finally {
      this.releaseSlot();
    }
  }

  // --- concurrency: FIFO semaphore ---

  private acquireSlot(): Promise<void> {
    if (this.active < this.deps.config.maxConcurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.waiters.shift();
    if (next) next(); // hand the slot straight to the next waiter (active stays put)
    else this.active--;
  }

  // --- rate: token bucket ---

  private refill(): void {
    const now = this.deps.clock.now().getTime();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.deps.config.bucketCapacity, this.tokens + elapsedSec * this.deps.config.refillPerSec);
    this.lastRefill = now;
  }

  private async consumeToken(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      const waitMs = Math.ceil(((1 - this.tokens) / this.deps.config.refillPerSec) * 1000);
      await this.deps.sleeper.sleep(waitMs);
    }
  }

  // --- resilience: adaptive backoff on 429 ---

  private async callWithBackoff<T>(call: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (err) {
        if (!isRateLimited(err) || attempt >= this.maxRetries) throw err;
        const backoff = retryAfterOf(err) ?? Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** attempt);
        await this.deps.sleeper.sleep(backoff);
      }
    }
  }
}
