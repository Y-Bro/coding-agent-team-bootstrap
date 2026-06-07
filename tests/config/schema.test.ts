import { test } from "node:test";
import assert from "node:assert/strict";
import { TeamConfigSchema } from "../../src/config/schema.ts";

test("timers default to 10min stall / 30min dead-letter / 30s sweep", () => {
  const cfg = TeamConfigSchema.parse({ name: "t", agents: [{ id: "a", role: "r" }] });
  assert.equal(cfg.timers.stallMs, 600000);
  assert.equal(cfg.timers.deadLetterMs, 1800000);
  assert.equal(cfg.timers.sweepIntervalMs, 30000);
});

test("bus defaults to memory and rejects unknown kinds", () => {
  const base = { name: "t", agents: [{ id: "a", role: "r" }] };
  const ok = TeamConfigSchema.parse(base);
  assert.equal(ok.bus.kind, "memory");
  assert.throws(() => TeamConfigSchema.parse({ ...base, bus: { kind: "kafka" } }));
});
