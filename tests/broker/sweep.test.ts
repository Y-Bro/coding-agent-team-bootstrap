import { test } from "node:test";
import assert from "node:assert/strict";
import { SweepLoop, type SweepPolicy } from "../../src/broker/sweep.ts";
import { FixedClock } from "../ports/fakes.ts";

test("tick() runs every policy with the current time", () => {
  const calls: string[] = [];
  const p: SweepPolicy = { run: (now) => calls.push(now.toISOString()) };
  const clock = new FixedClock("2026-06-07T00:00:00.000Z");
  const loop = new SweepLoop({ clock, sleeper: { sleep: async () => {} }, intervalMs: 1000, policies: [p, p] });
  loop.tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, ["2026-06-07T00:00:00.000Z", "2026-06-07T00:00:00.000Z"]);
});
