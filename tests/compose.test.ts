import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContainer } from "../src/compose.ts";
import { loadConfig } from "../src/config/index.ts";
import { PanesRuntime } from "../src/runtime/panes.ts";
import { ServersRuntime } from "../src/runtime/servers.ts";

const templates = { lead: "# {{id}}", writer: "# {{id}}", reviewer: "# {{id}}" };

test("buildContainer wires broker, daemon and bootstrapper", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  const c = buildContainer(cfg, templates);
  assert.equal(typeof c.broker.send, "function");
  assert.equal(typeof c.daemon.start, "function");
  assert.equal(typeof c.bootstrapper.up, "function");
});

test("buildContainer selects the runtime from config", () => {
  const panes = buildContainer(loadConfig("tests/config/fixtures/todo.yaml"), templates);
  assert.ok(panes.runtime instanceof PanesRuntime);
  const servers = buildContainer(
    { ...loadConfig("tests/config/fixtures/todo.yaml"), runtime: "servers" as const },
    templates,
  );
  assert.ok(servers.runtime instanceof ServersRuntime);
});
