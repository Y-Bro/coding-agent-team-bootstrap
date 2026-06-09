import { test } from "node:test";
import assert from "node:assert/strict";
import { CompositeRuntime } from "../../src/runtime/composite.ts";
import type { Runtime, SpawnCtx } from "../../src/runtime/runtime.ts";
import type { AgentCard } from "../../src/a2a/index.ts";

class SpyRuntime implements Runtime {
  spawned: string[] = [];
  woke: string[] = [];
  tornDown = 0;
  async spawn(a: AgentCard, _c: SpawnCtx): Promise<void> { this.spawned.push(a.id); }
  async wake(id: string): Promise<void> { this.woke.push(id); }
  async teardown(): Promise<void> { this.tornDown++; }
}

const card = (id: string, runtime?: "panes" | "servers"): AgentCard => ({
  id, role: "writer", cli: "claude", engine: "claude", capabilities: [], skills: [],
  workdir: ".", subscribes: [], ...(runtime ? { runtime } : {}),
} as AgentCard & { runtime?: string });

const ctx: SpawnCtx = { config: {} as any, socketPath: "/tmp/s.sock", projectRoot: "/proj" };

function setup() {
  const panes = new SpyRuntime();
  const servers = new SpyRuntime();
  const rt = new CompositeRuntime(
    { panes, servers },
    (a) => ((a as { runtime?: "panes" | "servers" }).runtime ?? "panes"),
  );
  return { rt, panes, servers };
}

test("spawns each agent on its resolved runtime", async () => {
  const { rt, panes, servers } = setup();
  await rt.spawn(card("p"), ctx);                 // default → panes
  await rt.spawn(card("s", "servers"), ctx);      // override → servers
  assert.deepEqual(panes.spawned, ["p"]);
  assert.deepEqual(servers.spawned, ["s"]);
});

test("wakes an agent on the same runtime it was spawned on", async () => {
  const { rt, panes, servers } = setup();
  await rt.spawn(card("p"), ctx);
  await rt.spawn(card("s", "servers"), ctx);
  await rt.wake("p", "mail");
  await rt.wake("s", "mail");
  assert.deepEqual(panes.woke, ["p"]);
  assert.deepEqual(servers.woke, ["s"]);
});

test("wake throws for an unknown agent", async () => {
  const { rt } = setup();
  await assert.rejects(() => rt.wake("ghost", "x"), /unknown agent/);
});

test("teardown tears each distinct runtime down once", async () => {
  const { rt, panes, servers } = setup();
  await rt.teardown();
  assert.equal(panes.tornDown, 1);
  assert.equal(servers.tornDown, 1);
});
