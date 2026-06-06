import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContainer } from "../src/compose.ts";
import { loadConfig } from "../src/config/index.ts";
import { PanesRuntime } from "../src/runtime/panes.ts";
import { ServersRuntime } from "../src/runtime/servers/servers.ts";
import { SocketTransport } from "../src/broker/transport.ts";
import { A2ATransport } from "../src/broker/a2a-transport.ts";
import { DirectMessenger } from "../src/a2a/direct.ts";
import type { TeamConfig } from "../src/config/index.ts";

const templates = { lead: "# {{id}}", writer: "# {{id}}", reviewer: "# {{id}}" };

// servers mode requires kind:"server" engines, so map every agent to a custom one.
function serversConfig(): TeamConfig {
  const base = loadConfig("tests/config/fixtures/todo.yaml");
  return {
    ...base,
    runtime: "servers",
    engines: { srv: { command: "srv", roleFile: "AGENTS.md", kind: "server" } },
    agents: base.agents.map((a) => ({ ...a, engine: "srv" })),
  };
}

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
  const servers = buildContainer(serversConfig(), templates);
  assert.ok(servers.runtime instanceof ServersRuntime);
});

test("buildContainer selects the transport from config (socket vs a2a)", () => {
  const panes = buildContainer(loadConfig("tests/config/fixtures/todo.yaml"), templates);
  assert.ok(panes.transport instanceof SocketTransport);
  const servers = buildContainer(serversConfig(), templates);
  assert.ok(servers.transport instanceof A2ATransport);
});

test("buildContainer wires a DirectMessenger only in servers + delivery:direct (v3 COEXIST)", () => {
  // default (broker-mediated): no messenger
  assert.equal(buildContainer(serversConfig(), templates).messenger, undefined);
  // direct mode in servers: a DirectMessenger, broker transport still present
  const direct = buildContainer({ ...serversConfig(), delivery: "direct" }, templates);
  assert.ok(direct.messenger instanceof DirectMessenger);
  assert.ok(direct.transport instanceof A2ATransport); // broker-mediated path coexists
});

test("buildContainer rejects delivery:direct in panes mode (no A2A endpoints)", () => {
  const cfg = { ...loadConfig("tests/config/fixtures/todo.yaml"), delivery: "direct" as const };
  assert.throws(() => buildContainer(cfg, templates), /requires runtime: servers/);
});
