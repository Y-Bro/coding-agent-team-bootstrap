import { test } from "node:test";
import assert from "node:assert/strict";
import { selectRuntime } from "../../src/runtime/select.ts";
import { PanesRuntime } from "../../src/runtime/panes.ts";
import { ServersRuntime } from "../../src/runtime/servers.ts";
import { loadConfig } from "../../src/config/index.ts";
import type { TmuxCommands } from "../../src/ports/tmux.ts";

class SpyTmux implements TmuxCommands {
  run(): string { return ""; }
}

test("selects PanesRuntime for runtime: panes", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml"); // runtime: panes
  assert.ok(selectRuntime(cfg, new SpyTmux()) instanceof PanesRuntime);
});

test("selects ServersRuntime for runtime: servers", () => {
  const cfg = { ...loadConfig("tests/config/fixtures/todo.yaml"), runtime: "servers" as const };
  assert.ok(selectRuntime(cfg, new SpyTmux()) instanceof ServersRuntime);
});
