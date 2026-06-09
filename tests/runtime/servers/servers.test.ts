import { test } from "node:test";
import assert from "node:assert/strict";
import { ServersRuntime, assertServerEngine, type AgentLink } from "../../../src/runtime/servers/servers.ts";
import { resolveEngines } from "../../../src/engines/index.ts";
import type { ProcessHandle, ProcessSpawner } from "../../../src/ports/process.ts";
import type { AgentCard } from "../../../src/a2a/index.ts";

class FakeHandle implements ProcessHandle {
  killed = false;
  async kill(): Promise<void> { this.killed = true; }
}
class FakeSpawner implements ProcessSpawner {
  launches: Array<{ command: string; env?: Record<string, string>; cwd?: string }> = [];
  handles: FakeHandle[] = [];
  spawn(command: string, opts: { args?: string[]; env?: Record<string, string>; cwd?: string }): ProcessHandle {
    this.launches.push({ command, env: opts.env, cwd: opts.cwd });
    const h = new FakeHandle(); this.handles.push(h); return h;
  }
}
class FakeLink implements AgentLink {
  registered: string[] = [];
  notified: Array<{ id: string; summary: string }> = [];
  async register(card: AgentCard): Promise<void> { this.registered.push(card.id); }
  async notify(card: AgentCard, summary: string): Promise<void> { this.notified.push({ id: card.id, summary }); }
}

// engines with a custom server engine + the built-in repl engines
const engines = () => resolveEngines({ engines: { srv: { command: "srv-bin", roleFile: "AGENTS.md", kind: "server" } } });

const card = (over: Partial<AgentCard>): AgentCard => ({
  id: "a", role: "writer", cli: "codex", engine: "srv",
  capabilities: [], skills: [], workdir: "work", subscribes: [], ...over,
});
const ctx = { config: {} as any, socketPath: ".team/broker.sock", projectRoot: "/proj" };

test("spawn launches the engine process, registers the card", async () => {
  const spawner = new FakeSpawner();
  const link = new FakeLink();
  const rt = new ServersRuntime({ spawner, engines: engines(), link });
  await rt.spawn(card({ id: "fe" }), ctx);

  assert.equal(spawner.launches.length, 1);
  assert.equal(spawner.launches[0]!.command, "srv-bin");
  assert.equal(spawner.launches[0]!.env!.TEAM_AGENT_ID, "fe");
  assert.equal(spawner.launches[0]!.cwd, "work");
  assert.deepEqual(link.registered, ["fe"]);
});

test("spawn rejects a non-server (repl) engine with a clear error", async () => {
  const rt = new ServersRuntime({ spawner: new FakeSpawner(), engines: engines(), link: new FakeLink() });
  await assert.rejects(() => rt.spawn(card({ engine: "claude" }), ctx), /requires kind:"server"/);
});

test("wake notifies the agent via the link", async () => {
  const link = new FakeLink();
  const rt = new ServersRuntime({ spawner: new FakeSpawner(), engines: engines(), link });
  await rt.spawn(card({ id: "fe" }), ctx);
  await rt.wake("fe", "review_request from x");
  assert.deepEqual(link.notified, [{ id: "fe", summary: "review_request from x" }]);
});

test("wake on an unknown agent throws", async () => {
  const rt = new ServersRuntime({ spawner: new FakeSpawner(), engines: engines(), link: new FakeLink() });
  await assert.rejects(() => rt.wake("ghost", "x"), /unknown agent/);
});

test("teardown gracefully kills every spawned process", async () => {
  const spawner = new FakeSpawner();
  const rt = new ServersRuntime({ spawner, engines: engines(), link: new FakeLink() });
  await rt.spawn(card({ id: "a" }), ctx);
  await rt.spawn(card({ id: "b" }), ctx);
  await rt.teardown();
  assert.equal(spawner.handles.length, 2);
  assert.ok(spawner.handles.every((h) => h.killed));
});

test("assertServerEngine throws for repl engines and passes for server engines", () => {
  assert.doesNotThrow(() => assertServerEngine("srv", engines()));
  assert.throws(() => assertServerEngine("claude", engines()), /requires kind:"server"/);
  assert.throws(() => assertServerEngine("nope", engines()), /unknown engine/);
});
