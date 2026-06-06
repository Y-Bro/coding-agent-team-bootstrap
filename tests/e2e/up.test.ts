import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { Broker } from "../../src/broker/broker.ts";
import { JsonlStore } from "../../src/broker/store.ts";
import { AgentRegistry } from "../../src/broker/registry.ts";
import { Router } from "../../src/broker/router.ts";
import { FeedRenderer } from "../../src/broker/feed.ts";
import { BrokerDaemon } from "../../src/broker/daemon.ts";
import { NodeSocketServer, NodeSocketClient } from "../../src/ports/transport.ts";
import { BrokerClient } from "../../src/client/rpc.ts";
import { NodeFileSystem } from "../../src/ports/fs.ts";
import { SystemClock } from "../../src/ports/clock.ts";
import { UuidGenerator } from "../../src/ports/ids.ts";
import type { Runtime } from "../../src/runtime/runtime.ts";

const noopRuntime: Runtime = { async spawn() {}, async wake() {}, async teardown() {} };

test("end-to-end: register two agents, send over the socket, recipient drains it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "team-"));
  const sock = join(dir, "broker.sock");
  const fs = new NodeFileSystem();
  const registry = new AgentRegistry();
  const broker = new Broker({
    store: new JsonlStore(fs, join(dir, "messages.jsonl")),
    registry, router: new Router(registry),
    feed: new FeedRenderer(fs, join(dir, "feed.md")),
    runtime: noopRuntime, clock: new SystemClock(), ids: new UuidGenerator(),
  });
  broker.register({ id: "a", role: "writer", cli: "claude", capabilities: [], skills: [], workdir: ".", subscribes: [] });
  broker.register({ id: "b", role: "reviewer", cli: "codex", capabilities: [], skills: [], workdir: ".", subscribes: ["review_request"] });

  const daemon = new BrokerDaemon(broker, new NodeSocketServer());
  await daemon.start(sock);
  try {
    const client = new BrokerClient(new NodeSocketClient(), sock);
    await client.send({ from: "a", to: "b", type: "review_request", parts: [{ kind: "text", text: "slice 4" }] });
    const inbox = (await client.inbox("b")) as any[];
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].type, "review_request");
  } finally {
    await daemon.stop();
  }
});
