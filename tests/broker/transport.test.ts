import { test } from "node:test";
import assert from "node:assert/strict";
import { SocketTransport } from "../../src/broker/transport.ts";
import type { Runtime, SpawnCtx } from "../../src/runtime/runtime.ts";
import type { AgentCard, Message } from "../../src/a2a/index.ts";

class SpyRuntime implements Runtime {
  woke: Array<{ id: string; summary: string }> = [];
  async spawn(_a: AgentCard, _c: SpawnCtx): Promise<void> {}
  async wake(id: string, summary: string): Promise<void> { this.woke.push({ id, summary }); }
  async teardown(): Promise<void> {}
}

const card: AgentCard = {
  id: "fe-reviewer", role: "reviewer", cli: "codex", engine: "codex",
  capabilities: [], skills: [], workdir: ".", subscribes: [],
};
const msg: Message = {
  id: "m1", from: "fe-writer", to: "fe-reviewer", type: "review_request",
  parts: [{ kind: "text", text: "slice 4" }], ts: "2026-06-06T00:00:00.000Z",
};

test("SocketTransport.deliver nudges the recipient's pane via the runtime", async () => {
  const runtime = new SpyRuntime();
  const t = new SocketTransport(runtime);
  await t.deliver(card, msg);
  assert.deepEqual(runtime.woke, [{ id: "fe-reviewer", summary: "review_request from fe-writer" }]);
});

test("SocketTransport listen/close are no-ops (inbound is the daemon socket)", async () => {
  const t = new SocketTransport(new SpyRuntime());
  await t.listen();
  await t.close();
});
