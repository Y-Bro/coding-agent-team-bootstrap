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
import type { Transport } from "../../src/broker/transport.ts";
import type { MessageObserver } from "../../src/broker/broker.ts";
import type { AgentCard, Message } from "../../src/a2a/index.ts";

class SpyTransport implements Transport {
  delivered: string[] = [];
  async deliver(r: AgentCard, m: Message): Promise<void> { this.delivered.push(`${r.id}:${m.id}`); }
  async listen(): Promise<void> {}
  async close(): Promise<void> {}
}

const card = (id: string, over: Partial<AgentCard> = {}): AgentCard => ({
  id, role: "writer", cli: "claude", engine: "claude", capabilities: [], skills: [],
  workdir: ".", subscribes: [], ...over,
});

function isSandboxNetError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EADDRNOTAVAIL";
}

test("a separate-process agent posts its observer copy over the socket; rebuild reconstructs", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "observe-wire-"));
  const sock = join(dir, "broker.sock");
  const fs = new NodeFileSystem();
  const transport = new SpyTransport();
  const registry = new AgentRegistry();
  const broker = new Broker({
    store: new JsonlStore(fs, join(dir, "messages.jsonl")),
    registry, router: new Router(registry),
    feed: new FeedRenderer(fs, join(dir, "feed.md")),
    transport, clock: new SystemClock(), ids: new UuidGenerator(),
  });
  broker.register(card("a"));
  broker.register(card("b", { subscribes: ["review_request"] }));

  const daemon = new BrokerDaemon(broker, new NodeSocketServer());
  try {
    await daemon.start(sock);
  } catch (e) {
    if (isSandboxNetError(e)) { t.skip(`sandbox blocks unix sockets: ${(e as Error).message}`); return; }
    throw e;
  }
  try {
    // The agent delivered this message peer-to-peer; it now posts the observer
    // copy to the broker over the wire, behind the MessageObserver seam.
    const observer: MessageObserver = new BrokerClient(new NodeSocketClient(), sock);
    const m: Message = {
      id: "m-wire-1", from: "a", to: "b", type: "review_request",
      parts: [{ kind: "text", text: "over the wire" }], ts: "2026-06-06T00:00:00.000Z",
    };
    await observer.observe(m);

    // broker logged it WITHOUT delivering over its transport
    assert.deepEqual(transport.delivered, []);
    assert.equal(broker.inbox("b").length, 1);

    // a fresh broker over the same log rebuilds the recipient's inbox
    const registry2 = new AgentRegistry();
    const broker2 = new Broker({
      store: new JsonlStore(fs, join(dir, "messages.jsonl")),
      registry: registry2, router: new Router(registry2),
      feed: new FeedRenderer(fs, join(dir, "feed.md")),
      transport: new SpyTransport(), clock: new SystemClock(), ids: new UuidGenerator(),
    });
    broker2.register(card("b", { subscribes: ["review_request"] }));
    broker2.rebuild();
    assert.equal(broker2.inbox("b").length, 1);
  } finally {
    await daemon.stop();
  }
});
