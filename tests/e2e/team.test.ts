import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../src/config/index.ts";
import { toCard } from "../../src/bootstrap/roles.ts";
import { Bootstrapper } from "../../src/bootstrap/bootstrapper.ts";
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
import { MemoryFs } from "../ports/fakes.ts";
import type { GitCommands } from "../../src/ports/git.ts";
import type { Runtime, SpawnCtx } from "../../src/runtime/runtime.ts";
import type { AgentCard } from "../../src/a2a/index.ts";
import { resolveEngines } from "../../src/engines/index.ts";

class SpyGit implements GitCommands {
  calls: string[][] = [];
  run(args: string[]): string { this.calls.push(args); return ""; }
}
class SpyRuntime implements Runtime {
  spawned: string[] = [];
  async spawn(a: AgentCard, _c: SpawnCtx): Promise<void> { this.spawned.push(a.id); }
  async wake(): Promise<void> {}
  async teardown(): Promise<void> {}
}

function templates(): Record<string, string> {
  return {
    lead: readFileSync("templates/lead.md", "utf8"),
    writer: readFileSync("templates/writer.md", "utf8"),
    reviewer: readFileSync("templates/reviewer.md", "utf8"),
  };
}

test("bootstraps the vibe-do-list team from team.yaml: worktrees, cards, role files, spawns", async () => {
  const cfg = loadConfig("team.yaml");
  const fs = new MemoryFs();
  const git = new SpyGit();
  const runtime = new SpyRuntime();
  const registered: string[] = [];
  const boot = new Bootstrapper(cfg, {
    runtime, git, fs, engines: resolveEngines(cfg), templates: templates(),
    register: (card) => registered.push(card.id),
  });

  await boot.up(".team/broker.sock");

  // one worktree add per declaring agent (fe-writer, be-writer)
  assert.equal(git.calls.filter((c) => c[0] === "worktree" && c[1] === "add").length, 2);
  // every agent registered with the broker roster
  assert.deepEqual(registered, cfg.agents.map((a) => a.id));
  // a card per agent
  for (const a of cfg.agents) assert.ok(fs.exists(`.team/cards/${a.id}.json`), `card for ${a.id}`);
  assert.equal(JSON.parse(fs.read(".team/cards/be-reviewer.json")).cli, "codex");
  // role file rendered from the writer template into the lead's dir
  assert.match(fs.read("./CLAUDE.md"), /lead \/ orchestrator/);
  // every agent spawned, in config order
  assert.deepEqual(runtime.spawned, cfg.agents.map((a) => a.id));
});

test("routes a config-driven message by subscription over a real socket", async () => {
  const cfg = loadConfig("team.yaml");
  const dir = mkdtempSync(join(tmpdir(), "team-e2e-"));
  const sock = join(dir, "broker.sock");
  const fs = new NodeFileSystem();
  const registry = new AgentRegistry();
  const broker = new Broker({
    store: new JsonlStore(fs, join(dir, "messages.jsonl")),
    registry, router: new Router(registry),
    feed: new FeedRenderer(fs, join(dir, "feed.md")),
    transport: { async deliver() {}, async listen() {}, async close() {} },
    clock: new SystemClock(), ids: new UuidGenerator(),
  });
  // register the whole team straight from config
  for (const a of cfg.agents) broker.register(toCard(a));

  const daemon = new BrokerDaemon(broker, new NodeSocketServer());
  await daemon.start(sock);
  try {
    const client = new BrokerClient(new NodeSocketClient(), sock);
    // a 'ruling' aimed at the lead also fans out to its 'ruling' subscribers
    // (fe-writer, be-writer) per their team.yaml subscriptions.
    await client.send({ from: "lead", to: "lead", type: "ruling", parts: [{ kind: "text", text: "ship it" }] });
    assert.equal((await client.inbox("fe-writer")).length, 1);
    assert.equal((await client.inbox("be-writer")).length, 1);
    assert.equal((await client.inbox("lead")).length, 1);
    // a reviewer only gets review_request (its subscription), not the ruling
    assert.equal((await client.inbox("fe-reviewer")).length, 0);

    await client.send({ from: "fe-writer", to: "fe-reviewer", type: "review_request", parts: [{ kind: "text", text: "PR #1" }] });
    assert.equal((await client.inbox("fe-reviewer")).length, 1);
  } finally {
    await daemon.stop();
  }
});
