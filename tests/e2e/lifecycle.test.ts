import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { teamUp } from "../../src/client/lifecycle.ts";
import type { BootstrapLike, ProcessControl } from "../../src/client/lifecycle.ts";
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

const noopBootstrap: BootstrapLike = { async up() {}, async down() {} };

test("after teamUp the broker stays alive and reachable (no process.exit)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "team-life-"));
  const sock = join(dir, "broker.sock");
  const pidfile = join(dir, "broker.pid");
  const fs = new NodeFileSystem();
  const registry = new AgentRegistry();
  const broker = new Broker({
    store: new JsonlStore(fs, join(dir, "messages.jsonl")),
    registry, router: new Router(registry),
    feed: new FeedRenderer(fs, join(dir, "feed.md")),
    transport: { async deliver() {}, async listen() {}, async close() {} },
    clock: new SystemClock(), ids: new UuidGenerator(),
  });
  broker.register({ id: "a", role: "writer", cli: "claude", engine: "claude", capabilities: [], skills: [], workdir: ".", subscribes: [] });
  broker.register({ id: "b", role: "reviewer", cli: "codex", engine: "codex", capabilities: [], skills: [], workdir: ".", subscribes: ["review_request"] });

  const daemon = new BrokerDaemon(broker, new NodeSocketServer());
  const proc: ProcessControl = { pid: 9999, kill() {}, onShutdown() {} };

  await teamUp(daemon, noopBootstrap, sock, { fs, proc, pidfile });
  try {
    // pidfile recorded so `team down` can target the running daemon
    assert.equal(fs.read(pidfile), "9999");
    // the daemon is still listening — a real client round-trips
    const client = new BrokerClient(new NodeSocketClient(), sock);
    await client.send({ from: "a", to: "b", type: "review_request", parts: [{ kind: "text", text: "hi" }] });
    assert.equal((await client.inbox("b")).length, 1);
  } finally {
    await daemon.stop();
  }
});
