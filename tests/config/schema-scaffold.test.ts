import { test } from "node:test";
import assert from "node:assert/strict";
import { TeamConfigSchema } from "../../src/config/schema.ts";

const base = { name: "t", agents: [{ id: "a", role: "writer", cli: "claude" }] };

test("scaffold.generator defaults to claude", () => {
  const cfg = TeamConfigSchema.parse(base);
  assert.equal(cfg.scaffold.generator, "claude");
});

test("scaffold.generator accepts a config-defined engine", () => {
  const cfg = TeamConfigSchema.parse({
    ...base,
    engines: { mine: { command: "mycli", roleFile: "MINE.md" } },
    scaffold: { generator: "mine" },
  });
  assert.equal(cfg.scaffold.generator, "mine");
});

test("unknown scaffold.generator is rejected", () => {
  assert.throws(() => TeamConfigSchema.parse({ ...base, scaffold: { generator: "nope" } }),
    /scaffold generator.*nope.*valid:.*claude/s);
});
