import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContainer } from "../src/compose.ts";
import { loadConfig } from "../src/config/index.ts";
import { PanesRuntime } from "../src/runtime/panes.ts";
import { ServersRuntime } from "../src/runtime/servers/servers.ts";
import { SocketTransport } from "../src/broker/transport.ts";
import { A2ATransport } from "../src/broker/a2a-transport.ts";
import { CompositeTransport } from "../src/broker/composite-transport.ts";
import { CompositeRuntime } from "../src/runtime/composite.ts";
import { DirectMessenger } from "../src/a2a/direct.ts";
import { MemoryBus } from "../src/broker/bus.ts";
import type { TeamConfig } from "../src/config/index.ts";
import type { AgentCard } from "../src/a2a/index.ts";

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
  assert.throws(() => buildContainer(cfg, templates), /every agent to run on the servers runtime/);
});

// a MIXED team: team default panes, one agent overridden to a server engine.
function mixedConfig(): TeamConfig {
  const base = loadConfig("tests/config/fixtures/todo.yaml"); // runtime: panes
  return {
    ...base,
    engines: { srv: { command: "srv", roleFile: "AGENTS.md", kind: "server" } },
    agents: base.agents.map((a, i) =>
      i === 0 ? { ...a, runtime: "servers" as const, engine: "srv" } : a),
  };
}

test("buildContainer bridges a mixed team: CompositeRuntime + CompositeTransport", () => {
  const c = buildContainer(mixedConfig(), templates);
  assert.ok(c.runtime instanceof CompositeRuntime);
  assert.ok(c.transport instanceof CompositeTransport);
});

test("buildContainer builds the dashboard only when dashboard.enabled (opt-in)", () => {
  const base = loadConfig("tests/config/fixtures/todo.yaml");
  assert.equal(buildContainer(base, templates).dashboard, undefined);
  const on = buildContainer({ ...base, dashboard: { enabled: true, port: 8123 } }, templates);
  assert.ok(on.dashboard);
  assert.equal(on.dashboard!.port, 8123);
});

test("buildContainer wires an ALWAYS-ON MemoryBus publisher even with the dashboard off", async () => {
  const base = loadConfig("tests/config/fixtures/todo.yaml"); // dashboard disabled by default
  const c = buildContainer(base, templates);
  assert.equal(c.dashboard, undefined);          // dashboard stays off...
  assert.ok(c.bus instanceof MemoryBus);          // ...yet the bus is constructed

  // a message recorded by the composed broker reaches an always-on subscriber
  // (observe records + publishes without touching the real panes transport).
  const card = (id: string): AgentCard => ({
    id, role: "writer", cli: "claude", engine: "claude", capabilities: [], skills: [], workdir: ".", subscribes: [],
  });
  c.broker.register(card("a")); c.broker.register(card("b"));
  const seen: string[] = [];
  c.bus.subscribe((m) => seen.push(m.type));
  await c.broker.observe({ id: "m1", from: "a", to: "b", type: "note",
    parts: [{ kind: "text", text: "hi" }], ts: "2026-06-07T00:00:00Z" });
  assert.deepEqual(seen, ["note"]);
});

test("buildContainer builds the liveness sweep loop (startable in team up)", () => {
  const c = buildContainer(loadConfig("tests/config/fixtures/todo.yaml"), templates);
  assert.ok(c.sweep);
  assert.equal(typeof c.sweep.start, "function");
  assert.equal(typeof c.sweep.stop, "function");
});

test("buildContainer rejects delivery:direct on a MIXED team (>=1 pane agent has no A2A server)", () => {
  // preserves the v3-m1 invariant: direct delivery requires every agent on servers
  const cfg = { ...mixedConfig(), delivery: "direct" as const };
  assert.throws(() => buildContainer(cfg, templates), /every agent to run on the servers runtime/);
});

test("buildContainer still allows delivery:direct when EVERY agent runs on servers", () => {
  const c = buildContainer({ ...serversConfig(), delivery: "direct" }, templates);
  assert.ok(c.messenger instanceof DirectMessenger);
});
