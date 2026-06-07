import { test } from "node:test";
import assert from "node:assert/strict";
import { TeamConfigSchema } from "../../src/config/schema.ts";

test("accepts a builtin non-default engine (gemini)", () => {
  const cfg = TeamConfigSchema.parse({ name: "t", agents: [{ id: "a", role: "r", cli: "gemini" }] });
  assert.equal(cfg.agents[0]!.engine, "gemini");
});

test("accepts a config-defined engine", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t",
    engines: { mycli: { command: "mycli", roleFile: "AGENTS.md" } },
    agents: [{ id: "a", role: "r", cli: "mycli" }],
  });
  assert.equal(cfg.agents[0]!.engine, "mycli");
});

test("rejects an unknown engine with a helpful message", () => {
  assert.throws(
    () => TeamConfigSchema.parse({ name: "t", agents: [{ id: "a", role: "r", cli: "nope" }] }),
    /unknown engine.*nope.*valid:.*claude/s,
  );
});

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
