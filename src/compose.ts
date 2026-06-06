import type { TeamConfig } from "./config/index.ts";
import { Broker } from "./broker/broker.ts";
import { JsonlStore } from "./broker/store.ts";
import { AgentRegistry } from "./broker/registry.ts";
import { Router } from "./broker/router.ts";
import { FeedRenderer } from "./broker/feed.ts";
import { BrokerDaemon } from "./broker/daemon.ts";
import { selectRuntime } from "./runtime/select.ts";
import { Bootstrapper } from "./bootstrap/bootstrapper.ts";
import { SystemClock } from "./ports/clock.ts";
import { UuidGenerator } from "./ports/ids.ts";
import { NodeFileSystem } from "./ports/fs.ts";
import { NodeTmux } from "./ports/tmux.ts";
import { NodeGit } from "./ports/git.ts";
import { NodeSocketServer } from "./ports/transport.ts";
import type { Runtime } from "./runtime/runtime.ts";

export function buildContainer(cfg: TeamConfig, templates: Record<string, string>) {
  const fs = new NodeFileSystem();
  const registry = new AgentRegistry();
  const runtime: Runtime = selectRuntime(cfg, new NodeTmux());

  const broker = new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry,
    router: new Router(registry),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    runtime,
    clock: new SystemClock(),
    ids: new UuidGenerator(),
  });

  const daemon = new BrokerDaemon(broker, new NodeSocketServer());
  const bootstrapper = new Bootstrapper(cfg, { runtime, git: new NodeGit(), fs, templates });
  return { broker, daemon, bootstrapper, runtime };
}
