import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config/index.ts";
import { TeamConfigSchema } from "../../src/config/schema.ts";
import { DEFAULT_MESSAGE_TYPES } from "../../src/a2a/index.ts";

test("agent.engine defaults to 'claude' when omitted", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t",
    agents: [{ id: "lead", role: "lead" }],
  });
  assert.equal(cfg.agents[0]!.engine, "claude");
});

test("agent.engine defaults from cli when engine omitted", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t",
    agents: [{ id: "lead", role: "lead", cli: "codex" }],
  });
  assert.equal(cfg.agents[0]!.cli, "codex");
  assert.equal(cfg.agents[0]!.engine, "codex");
});

test("explicit agent.engine wins over cli", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t",
    engines: { x: { command: "x", roleFile: "AGENTS.md" } },
    agents: [{ id: "lead", role: "lead", cli: "codex", engine: "x" }],
  });
  assert.equal(cfg.agents[0]!.engine, "x");
});

test("top-level engines map accepts custom engine profiles", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t",
    engines: { mytool: { command: "mytool", roleFile: "MY.md" } },
    agents: [{ id: "a", role: "writer", engine: "mytool" }],
  });
  assert.equal(cfg.engines?.mytool!.command, "mytool");
  assert.equal(cfg.agents[0]!.engine, "mytool");
});

test("loadConfig parses and defaults a valid team.yaml", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  assert.equal(cfg.name, "todo");
  assert.equal(cfg.runtime, "panes");
  assert.equal(cfg.agents.length, 3);
  const fe = cfg.agents.find((a) => a.id === "fe-writer")!;
  assert.equal(fe.worktree?.branch, "feat/frontend");
  assert.deepEqual(fe.capabilities, ["frontend", "react"]);
  assert.deepEqual(cfg.agents[0]!.subscribes, []);
});

test("agent.window is optional and parsed when present", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t",
    agents: [
      { id: "a", role: "writer", window: "pair" },
      { id: "b", role: "reviewer", window: "pair" },
      { id: "c", role: "lead" },
    ],
  });
  assert.equal(cfg.agents[0]!.window, "pair");
  assert.equal(cfg.agents[1]!.window, "pair");
  assert.equal(cfg.agents[2]!.window, undefined);
});

test("top-level layout maps window name → tmux layout, defaults to {}", () => {
  const base = TeamConfigSchema.parse({ name: "t", agents: [{ id: "a", role: "writer" }] });
  assert.deepEqual(base.layout, {});

  const cfg = TeamConfigSchema.parse({
    name: "t",
    layout: { pair: "main-vertical" },
    agents: [{ id: "a", role: "writer", window: "pair" }],
  });
  assert.equal(cfg.layout.pair, "main-vertical");
});

test("layout rejects unknown tmux layout names", () => {
  assert.throws(() => TeamConfigSchema.parse({
    name: "t",
    layout: { pair: "not-a-layout" },
    agents: [{ id: "a", role: "writer" }],
  }));
});

test("agent.runtime is optional (team-level fallback) and accepts panes|servers", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t", runtime: "panes",
    agents: [
      { id: "a", role: "writer" },
      { id: "b", role: "reviewer", runtime: "servers" },
    ],
  });
  assert.equal(cfg.agents[0]!.runtime, undefined); // falls back to team-level
  assert.equal(cfg.agents[1]!.runtime, "servers");
  assert.throws(() => TeamConfigSchema.parse({
    name: "t", agents: [{ id: "a", role: "writer", runtime: "http" }],
  }));
});

test("agent host/url are optional and parsed; url must be a valid URL", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t", runtime: "servers",
    engines: { srv: { command: "x", roleFile: "AGENTS.md", kind: "server" } },
    agents: [
      { id: "a", role: "writer", engine: "srv", host: "10.0.0.5" },
      { id: "b", role: "reviewer", engine: "srv", url: "https://b.example.com:8443" },
    ],
  });
  assert.equal(cfg.agents[0]!.host, "10.0.0.5");
  assert.equal(cfg.agents[1]!.url, "https://b.example.com:8443");
  assert.throws(() => TeamConfigSchema.parse({
    name: "t", agents: [{ id: "a", role: "writer", url: "not a url" }],
  }));
});

test("servers.tls is optional and carries cert/key (+ optional ca)", () => {
  const off = TeamConfigSchema.parse({ name: "t", agents: [{ id: "a", role: "writer" }] });
  assert.equal(off.servers.tls, undefined); // default OFF
  const on = TeamConfigSchema.parse({
    name: "t", servers: { tls: { cert: "cert.pem", key: "key.pem", ca: "ca.pem" } },
    agents: [{ id: "a", role: "writer" }],
  });
  assert.deepEqual(on.servers.tls, { cert: "cert.pem", key: "key.pem", ca: "ca.pem" });
  assert.throws(() => TeamConfigSchema.parse({
    name: "t", servers: { tls: { cert: "cert.pem" } }, agents: [{ id: "a", role: "writer" }],
  }));
});

test("dashboard is opt-in: disabled by default, configurable port", () => {
  const off = TeamConfigSchema.parse({ name: "t", agents: [{ id: "a", role: "writer" }] });
  assert.equal(off.dashboard.enabled, false);
  assert.equal(off.dashboard.port, 41999);
  const on = TeamConfigSchema.parse({ name: "t", dashboard: { enabled: true, port: 8080 }, agents: [{ id: "a", role: "writer" }] });
  assert.equal(on.dashboard.enabled, true);
  assert.equal(on.dashboard.port, 8080);
});

test("servers auth hardening knobs are optional (tokenTtlSec/secret), default off", () => {
  const off = TeamConfigSchema.parse({ name: "t", agents: [{ id: "a", role: "writer" }] });
  assert.equal(off.servers.tokenTtlSec, undefined);
  assert.equal(off.servers.secret, undefined);
  const on = TeamConfigSchema.parse({
    name: "t", servers: { tokenTtlSec: 900, secret: "s3cret" },
    agents: [{ id: "a", role: "writer" }],
  });
  assert.equal(on.servers.tokenTtlSec, 900);
  assert.equal(on.servers.secret, "s3cret");
  assert.throws(() => TeamConfigSchema.parse({
    name: "t", servers: { tokenTtlSec: -1 }, agents: [{ id: "a", role: "writer" }],
  }));
});

test("delivery defaults to broker-mediated and accepts direct", () => {
  const def = TeamConfigSchema.parse({ name: "t", agents: [{ id: "a", role: "writer" }] });
  assert.equal(def.delivery, "broker");
  const direct = TeamConfigSchema.parse({ name: "t", delivery: "direct", agents: [{ id: "a", role: "writer" }] });
  assert.equal(direct.delivery, "direct");
  assert.throws(() => TeamConfigSchema.parse({ name: "t", delivery: "p2p", agents: [{ id: "a", role: "writer" }] }));
});

test("loadConfig defaults messageTypes to the A2A vocabulary when omitted", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  assert.deepEqual(cfg.messageTypes, [...DEFAULT_MESSAGE_TYPES]);
});

test("loadConfig throws on duplicate agent ids", () => {
  assert.throws(() => loadConfig("tests/config/fixtures/dupe.yaml"), /duplicate/i);
});

test("servers block defaults: auth on, base port, and rate-limit knobs", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t",
    runtime: "servers",
    engines: { srv: { command: "srv", roleFile: "AGENTS.md", kind: "server" } },
    agents: [{ id: "a", role: "writer", engine: "srv" }],
  });
  assert.equal(cfg.servers.host, "127.0.0.1");
  assert.equal(cfg.servers.basePort, 41000);
  assert.equal(cfg.servers.auth, true);
  assert.equal(cfg.servers.rateLimit.maxConcurrency, 4);
  assert.equal(cfg.servers.rateLimit.bucketCapacity, 8);
  assert.equal(cfg.servers.rateLimit.refillPerSec, 2);
});

test("servers block honors explicit rate-limit + auth overrides", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t",
    runtime: "servers",
    engines: { srv: { command: "srv", roleFile: "AGENTS.md", kind: "server" } },
    servers: { basePort: 50000, auth: false, rateLimit: { maxConcurrency: 1, bucketCapacity: 2, refillPerSec: 0.5 } },
    agents: [{ id: "a", role: "writer", engine: "srv" }],
  });
  assert.equal(cfg.servers.basePort, 50000);
  assert.equal(cfg.servers.auth, false);
  assert.equal(cfg.servers.rateLimit.maxConcurrency, 1);
  assert.equal(cfg.servers.rateLimit.refillPerSec, 0.5);
});

test("an agent may override its A2A port", () => {
  const cfg = TeamConfigSchema.parse({
    name: "t",
    runtime: "servers",
    engines: { srv: { command: "srv", roleFile: "AGENTS.md", kind: "server" } },
    agents: [{ id: "a", role: "writer", engine: "srv", port: 42042 }],
  });
  assert.equal(cfg.agents[0]!.port, 42042);
});

test("servers.rateLimit rejects a non-positive maxConcurrency", () => {
  assert.throws(() => TeamConfigSchema.parse({
    name: "t", runtime: "servers",
    servers: { rateLimit: { maxConcurrency: 0 } },
    agents: [{ id: "a", role: "writer", engine: "srv" }],
  }));
});
