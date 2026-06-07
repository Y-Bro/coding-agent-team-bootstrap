import { test } from "node:test";
import assert from "node:assert/strict";
import { TeamConfigSchema } from "../../src/config/schema.ts";

test("bus defaults to memory and rejects unknown kinds", () => {
  const base = { name: "t", agents: [{ id: "a", role: "r" }] };
  const ok = TeamConfigSchema.parse(base);
  assert.equal(ok.bus.kind, "memory");
  assert.throws(() => TeamConfigSchema.parse({ ...base, bus: { kind: "kafka" } }));
});
