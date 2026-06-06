import { test } from "node:test";
import assert from "node:assert/strict";
import { selectRuntime } from "../../src/runtime/select.ts";
import { PanesRuntime } from "../../src/runtime/panes.ts";
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
  const rt = selectRuntime(cfg, new SpyTmux(), resolveEngines({}), makeServers());
  assert.ok(rt instanceof PanesRuntime);
});

test("selects ServersRuntime for runtime: servers with server engines", () => {
  const { cfg, engines } = serversCfg("server");
  const rt = selectRuntime(cfg, new SpyTmux(), engines, makeServers(engines));
  assert.ok(rt instanceof ServersRuntime);
});

test("servers mode rejects a repl-only engine with a clear error", () => {
  const { cfg, engines } = serversCfg("repl");
  assert.throws(
    () => selectRuntime(cfg, new SpyTmux(), engines, makeServers(engines)),
    /requires kind:"server"/,
  );
});
