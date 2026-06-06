import { test } from "node:test";
import assert from "node:assert/strict";
import { ServersRuntime } from "../../src/runtime/servers.ts";
import type { AgentCard } from "../../src/a2a/index.ts";

const card: AgentCard = { id: "x", role: "writer", cli: "claude", engine: "claude",
  capabilities: [], skills: [], workdir: ".", subscribes: [] };

test("spawn throws a clear, actionable not-implemented error", async () => {
  const rt = new ServersRuntime();
  await assert.rejects(
    () => rt.spawn(card, { config: {} as any, socketPath: ".team/broker.sock" }),
    /ServersRuntime not implemented.*runtime: panes/s,
  );
});

test("wake throws a clear not-implemented error", async () => {
  const rt = new ServersRuntime();
  await assert.rejects(() => rt.wake("x", "note from y"), /ServersRuntime not implemented/);
});

test("teardown is a clean no-op (nothing was spawned to release)", async () => {
  const rt = new ServersRuntime();
  await rt.teardown(); // must not throw
});
