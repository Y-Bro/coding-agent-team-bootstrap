import { test } from "node:test";
import assert from "node:assert/strict";
import { FleetScheduler, RateLimitError } from "../../../src/runtime/servers/scheduler.ts";
import type { Clock } from "../../../src/ports/clock.ts";
import type { Sleeper } from "../../../src/ports/sleeper.ts";

/** A clock the test advances by hand — no real time, fully deterministic. */
class ManualClock implements Clock {
  private ms = Date.parse("2026-06-06T00:00:00.000Z");
  now(): Date { return new Date(this.ms); }
  isoNow(): string { return this.now().toISOString(); }
  advance(ms: number): void { this.ms += ms; }
}

/** A sleeper that records each requested delay and advances the manual clock. */
class FakeSleeper implements Sleeper {
  durations: number[] = [];
  constructor(private clock: ManualClock) {}
  async sleep(ms: number): Promise<void> { this.durations.push(ms); this.clock.advance(ms); }
}

function defer<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

// Drain enough microtasks that every settled scheduler hop has run.
async function flush(): Promise<void> { for (let i = 0; i < 30; i++) await Promise.resolve(); }

// A bucket large enough that the token-rate gate never fires (isolate concurrency/backoff).
const bigBucket = { bucketCapacity: 1e9, refillPerSec: 1e9 };

test("bounds concurrent in-flight calls to maxConcurrency", async () => {
  const clock = new ManualClock();
  const s = new FleetScheduler({ clock, sleeper: new FakeSleeper(clock), config: { maxConcurrency: 2, ...bigBucket } });

  let active = 0, peak = 0;
  const gates = Array.from({ length: 5 }, () => defer<void>());
  const runs = gates.map((g, i) => s.run(`a${i}`, async () => {
    active++; peak = Math.max(peak, active);
    await g.promise;
    active--;
  }));

  await flush();
  assert.equal(peak, 2, "at most maxConcurrency calls run at once");

  gates.forEach((g) => g.resolve());
  await Promise.all(runs);
  assert.equal(peak, 2);
});

test("retries with exponential backoff on a 429", async () => {
  const clock = new ManualClock();
  const sleeper = new FakeSleeper(clock);
  const s = new FleetScheduler({ clock, sleeper, config: { maxConcurrency: 4, ...bigBucket, baseBackoffMs: 1000 } });

  let calls = 0;
  const out = await s.run("a", async () => {
    calls++;
    if (calls <= 2) throw new RateLimitError();
    return "ok";
  });
  assert.equal(out, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(sleeper.durations, [1000, 2000], "adaptive (doubling) backoff between retries");
});

test("honors retryAfterMs from the rate-limit error", async () => {
  const clock = new ManualClock();
  const sleeper = new FakeSleeper(clock);
  const s = new FleetScheduler({ clock, sleeper, config: { maxConcurrency: 4, ...bigBucket } });

  let calls = 0;
  await s.run("a", async () => { calls++; if (calls === 1) throw new RateLimitError(500); return "ok"; });
  assert.deepEqual(sleeper.durations, [500]);
});

test("rethrows after exhausting maxRetries", async () => {
  const clock = new ManualClock();
  const sleeper = new FakeSleeper(clock);
  const s = new FleetScheduler({ clock, sleeper, config: { maxConcurrency: 1, ...bigBucket, baseBackoffMs: 1, maxRetries: 2 } });

  let calls = 0;
  await assert.rejects(() => s.run("a", async () => { calls++; throw new RateLimitError(); }), /rate limited/);
  assert.equal(calls, 3, "initial attempt + maxRetries");
  assert.equal(sleeper.durations.length, 2);
});

test("does not retry non-rate-limit errors", async () => {
  const clock = new ManualClock();
  const s = new FleetScheduler({ clock, sleeper: new FakeSleeper(clock), config: { maxConcurrency: 1, ...bigBucket } });

  let calls = 0;
  await assert.rejects(() => s.run("a", async () => { calls++; throw new Error("boom"); }), /boom/);
  assert.equal(calls, 1);
});

test("token bucket throttles call rate, waiting for refill", async () => {
  const clock = new ManualClock();
  const sleeper = new FakeSleeper(clock);
  // 1-token burst, refilling 1 token/sec.
  const s = new FleetScheduler({ clock, sleeper, config: { maxConcurrency: 4, bucketCapacity: 1, refillPerSec: 1 } });

  await s.run("a", async () => {});           // spends the burst token, no wait
  await s.run("a", async () => {});           // must wait ~1s for a refill
  assert.deepEqual(sleeper.durations, [1000]);
});

test("admits queued calls in FIFO order (fairness across agents)", async () => {
  const clock = new ManualClock();
  const s = new FleetScheduler({ clock, sleeper: new FakeSleeper(clock), config: { maxConcurrency: 1, ...bigBucket } });

  const order: string[] = [];
  const gates = [defer<void>(), defer<void>(), defer<void>()];
  const ids = ["a", "b", "c"];
  const runs = ids.map((id, i) => s.run(id, async () => { order.push(id); await gates[i]!.promise; }));

  await flush();
  gates[0]!.resolve(); await flush();
  gates[1]!.resolve(); await flush();
  gates[2]!.resolve();
  await Promise.all(runs);
  assert.deepEqual(order, ["a", "b", "c"]);
});
