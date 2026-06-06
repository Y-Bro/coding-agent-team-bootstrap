import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContainer } from "../src/compose.ts";
import { loadConfig } from "../src/config/index.ts";
import { ServersRuntime } from "../src/runtime/servers.ts";

const templates = { lead: "# {{id}}", writer: "# {{id}}", reviewer: "# {{id}}" };

test("buildContainer wires broker, daemon and bootstrapper", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  const c = buildContainer(cfg, templates);
  assert.equal(typeof c.broker.send, "function");
  assert.equal(typeof c.daemon.start, "function");
  assert.equal(typeof c.bootstrapper.up, "function");
});

test("buildContainer selects the servers runtime when configured", async () => {
  const cfg = { ...loadConfig("tests/config/fixtures/todo.yaml"), runtime: "servers" as const };
  const c = buildContainer(cfg, templates);
  // ServersRuntime is a stub that throws on use, proving it was selected.
  await assert.rejects(() => c.bootstrapper.down(), /not implemented/);
});

test("ServersRuntime stub rejects every operation", async () => {
  const rt = new ServersRuntime();
  await assert.rejects(() => rt.wake(), /not implemented/);
});
