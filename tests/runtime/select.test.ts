import { test } from "node:test";
import assert from "node:assert/strict";
import { selectRuntime, effectiveRuntime } from "../../src/runtime/select.ts";
import { PanesRuntime } from "../../src/runtime/panes.ts";
import { CompositeRuntime } from "../../src/runtime/composite.ts";
import { ServersRuntime, type AgentLink } from "../../src/runtime/servers/servers.ts";
import { loadConfig } from "../../src/config/index.ts";
import type { TmuxCommands } from "../../src/ports/tmux.ts";
import type { ProcessSpawner, ProcessHandle } from "../../src/ports/process.ts";
import type { TeamConfig } from "../../src/config/index.ts";
import { resolveEngines } from "../../src/engines/index.ts";

class SpyTmux implements TmuxCommands {
  run(): string { return ""; }
}
const noopSpawner: ProcessSpawner = { spawn: () => ({ async kill() {} } as ProcessHandle) };
const noopLink: AgentLink = { async register() {}, async notify() {} };
const noSleep = { sleep: async () => {} };
const makeServers = (engines = resolveEngines({})) =>
  () => new ServersRuntime({ spawner: noopSpawner, engines, link: noopLink });

// a team with a custom server engine, in servers mode
function serversCfg(engineKind: "server" | "repl"): { cfg: TeamConfig; engines: ReturnType<typeof resolveEngines> } {
  const engines = resolveEngines({ engines: { srv: { command: "srv", roleFile: "AGENTS.md", kind: engineKind } } });
  const base = loadConfig("tests/config/fixtures/todo.yaml");
  const cfg = { ...base, runtime: "servers" as const, agents: base.agents.map((a) => ({ ...a, engine: "srv" })) };
  return { cfg, engines };
}

test("selects PanesRuntime for runtime: panes", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml"); // runtime: panes
  const rt = selectRuntime(cfg, new SpyTmux(), resolveEngines({}), makeServers(), noSleep);
  assert.ok(rt instanceof PanesRuntime);
});

test("selects ServersRuntime for runtime: servers with server engines", () => {
  const { cfg, engines } = serversCfg("server");
  const rt = selectRuntime(cfg, new SpyTmux(), engines, makeServers(engines), noSleep);
  assert.ok(rt instanceof ServersRuntime);
});

test("servers mode rejects a repl-only engine with a clear error", () => {
  const { cfg, engines } = serversCfg("repl");
  assert.throws(
    () => selectRuntime(cfg, new SpyTmux(), engines, makeServers(engines), noSleep),
    /requires kind:"server"/,
  );
});

test("effectiveRuntime: per-agent override wins, else team default", () => {
  assert.equal(effectiveRuntime({ runtime: "servers" }, { runtime: "panes" }), "servers");
  assert.equal(effectiveRuntime({ runtime: undefined }, { runtime: "panes" }), "panes");
});

test("builds a CompositeRuntime for a MIXED team (some panes, some servers)", () => {
  // team default panes; one agent overridden to servers (with a server engine)
  const engines = resolveEngines({ engines: { srv: { command: "srv", roleFile: "AGENTS.md", kind: "server" } } });
  const base = loadConfig("tests/config/fixtures/todo.yaml"); // runtime: panes
  const cfg: TeamConfig = {
    ...base,
    agents: base.agents.map((a, i) => (i === 0 ? { ...a, runtime: "servers" as const, engine: "srv" } : a)),
  };
  const rt = selectRuntime(cfg, new SpyTmux(), engines, makeServers(engines), noSleep);
  assert.ok(rt instanceof CompositeRuntime);
});

test("mixed team validates server-eligibility ONLY for agents hosted on servers", () => {
  // the servers-bound agent has a repl engine → must throw; pane agents with
  // repl engines are fine.
  const engines = resolveEngines({ engines: { rep: { command: "rep", roleFile: "AGENTS.md", kind: "repl" } } });
  const base = loadConfig("tests/config/fixtures/todo.yaml");
  const cfg: TeamConfig = {
    ...base,
    agents: base.agents.map((a, i) => (i === 0 ? { ...a, runtime: "servers" as const, engine: "rep" } : a)),
  };
  assert.throws(() => selectRuntime(cfg, new SpyTmux(), engines, makeServers(engines), noSleep), /requires kind:"server"/);
});
