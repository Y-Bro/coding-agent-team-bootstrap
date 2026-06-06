import type { TeamConfig } from "./config/index.ts";
import { Broker } from "./broker/broker.ts";
import { JsonlStore } from "./broker/store.ts";
import { AgentRegistry } from "./broker/registry.ts";
import { Router } from "./broker/router.ts";
import { FeedRenderer } from "./broker/feed.ts";
import { BrokerDaemon } from "./broker/daemon.ts";
import { SocketTransport, type Transport } from "./broker/transport.ts";
import { CompositeTransport } from "./broker/composite-transport.ts";
import { A2ATransport, type A2AEndpoints, type WebhookSender } from "./broker/a2a-transport.ts";
import { A2AClient } from "./a2a/http/index.ts";
import { DirectMessenger, type Messenger } from "./a2a/direct.ts";
import { BrokerAuthProvider, bearerHeader } from "./a2a/http/auth.ts";
import { throwIfRateLimited } from "./a2a/http/ratelimit.ts";
import { NodeHttpClient } from "./ports/http.ts";
import { selectRuntime, effectiveRuntime } from "./runtime/select.ts";
import type { RuntimeKind } from "./runtime/composite.ts";
import { ServersRuntime, type AgentLink } from "./runtime/servers/servers.ts";
import { NodeProcessSpawner } from "./ports/process.ts";
import { FleetScheduler } from "./runtime/servers/scheduler.ts";
import { RealSleeper } from "./ports/sleeper.ts";
import { Bootstrapper } from "./bootstrap/bootstrapper.ts";
import { SystemClock } from "./ports/clock.ts";
import { UuidGenerator } from "./ports/ids.ts";
import { NodeFileSystem } from "./ports/fs.ts";
import { NodeTmux } from "./ports/tmux.ts";
import { NodeGit } from "./ports/git.ts";
import { NodeSocketServer } from "./ports/transport.ts";
import type { Runtime } from "./runtime/runtime.ts";
import { resolveEngines } from "./engines/index.ts";
import { NodeWhich } from "./ports/which.ts";
import { NodePrompter, ScriptedPrompter, type Prompter } from "./ports/prompter.ts";
import { runDoctor, type DoctorReport } from "./bootstrap/doctor.ts";
import { runWizard, writeConfigYaml } from "./cli/wizard.ts";
import { formatDoctorReport } from "./cli/doctor-cmd.ts";
import { TeamConfigSchema } from "./config/schema.ts";
import { dirname, join } from "node:path";

type TokenFor = (agentId: string) => string | undefined;

/** Resolve each agent's A2A base URL from the servers block (per-agent port override wins). */
function a2aBaseUrl(cfg: TeamConfig): (agentId: string) => string {
  const indexById = new Map(cfg.agents.map((a, i) => [a.id, i] as const));
  return (id) => {
    const idx = indexById.get(id) ?? 0;
    const port = cfg.agents[idx]?.port ?? cfg.servers.basePort + idx;
    return `http://${cfg.servers.host}:${port}`;
  };
}

/** Build the A2A endpoint resolver: one A2AClient per agent (with its bearer). */
function a2aEndpoints(cfg: TeamConfig, tokenFor?: TokenFor): A2AEndpoints {
  const http = new NodeHttpClient();
  const baseUrl = a2aBaseUrl(cfg);
  return {
    clientFor: (recipient) => new A2AClient(http, baseUrl(recipient.id), tokenFor?.(recipient.id)),
  };
}

/** Push-webhook sender: POST the message to each recipient's localhost webhook (with its bearer). */
function a2aWebhook(cfg: TeamConfig, tokenFor?: TokenFor): WebhookSender {
  const http = new NodeHttpClient();
  const baseUrl = a2aBaseUrl(cfg);
  return {
    push: async (recipient, message) => {
      const token = tokenFor?.(recipient.id);
      const res = await http.request(`${baseUrl(recipient.id)}/webhook`, {
        method: "POST", body: JSON.stringify(message),
        headers: token !== undefined ? bearerHeader(token) : undefined,
      });
      throwIfRateLimited(res); // a 429 from the agent webhook drives scheduler backoff
    },
  };
}

/**
 * The servers-mode link: register a spawned agent with the in-process broker
 * (broker-mediated, per Q2) and notify it of waiting mail by pushing a status
 * message to its A2A endpoint.
 */
function a2aLink(cfg: TeamConfig, broker: Broker, clock: SystemClock, ids: UuidGenerator, tokenFor?: TokenFor): AgentLink {
  const endpoints = a2aEndpoints(cfg, tokenFor);
  return {
    register: async (card) => { broker.register(card); },
    notify: async (card, summary) => {
      await endpoints.clientFor(card).sendMessage({
        id: ids.next("m"), from: "broker", to: card.id, type: "status",
        parts: [{ kind: "text", text: summary }], ts: clock.isoNow(),
      });
    },
  };
}

export function buildContainer(cfg: TeamConfig, templates: Record<string, string>) {
  const fs = new NodeFileSystem();
  const registry = new AgentRegistry();
  const engines = resolveEngines(cfg);
  const clock = new SystemClock();
  const ids = new UuidGenerator();
  // All broker artifacts live alongside the socket, so a run-from-anywhere team
  // (absolute socket under base/.team) keeps its messages/feed/cards together.
  const teamDir = dirname(cfg.broker.socket);
  const makeBroker = (transport: Transport): Broker => new Broker({
    store: new JsonlStore(fs, join(teamDir, "messages.jsonl")),
    registry,
    router: new Router(registry),
    feed: new FeedRenderer(fs, join(teamDir, "feed.md")),
    transport,
    clock,
    ids,
  });

  // Each agent runs on its own runtime (panes/servers), else the team default.
  const kindById = new Map(cfg.agents.map((a) => [a.id, effectiveRuntime(a, cfg)] as const));
  const kindOf = (id: string): RuntimeKind => kindById.get(id) ?? cfg.runtime;
  const kinds = new Set(kindById.values());
  const needsServers = kinds.has("servers");
  const needsPanes = kinds.has("panes");

  // Direct delivery is peer-to-peer over A2A, so EVERY agent must run an A2A
  // server (v3-m1 invariant). In a mixed team a pane recipient has no A2A
  // endpoint, so reject direct outright — mixed teams use delivery: broker, where
  // the CompositeTransport bridges cross-runtime delivery. (Per-recipient
  // direct/broker hybrid is a future refinement, out of m2 scope.)
  if (cfg.delivery === "direct" && needsPanes) {
    throw new Error("delivery: direct requires every agent to run on the servers runtime");
  }

  // The runtime is built last (its servers factory needs the broker), but the
  // socket transport must exist before the broker — so it wakes through a lazy
  // Waker that resolves to the runtime at delivery time.
  let runtime: Runtime;
  const socketTransport = new SocketTransport({ wake: (id, summary) => runtime.wake(id, summary) });

  // Servers-side A2A wiring, built only when some agent runs on servers. Broker
  // mediates token issuance (one bearer per agent, Q5); one shared FleetScheduler
  // bounds the fleet's concurrent model-triggering deliveries (Q4).
  let endpoints: A2AEndpoints | undefined;
  let a2aTransport: A2ATransport | undefined;
  let tokenFor: TokenFor = () => undefined;
  if (needsServers) {
    const auth = cfg.servers.auth ? new BrokerAuthProvider(ids) : undefined;
    const tokens = new Map(auth ? cfg.agents.map((a) => [a.id, auth.issueToken(a.id)] as const) : []);
    tokenFor = (id) => tokens.get(id);
    const scheduler = new FleetScheduler({ clock, sleeper: new RealSleeper(), config: cfg.servers.rateLimit });
    endpoints = a2aEndpoints(cfg, tokenFor);
    a2aTransport = new A2ATransport(endpoints, a2aWebhook(cfg, tokenFor), scheduler);
  }

  // Single matching transport per kind; a mixed team bridges socket<->A2A by
  // recipient runtime (Q2) so pane and server agents exchange messages both ways.
  const transport: Transport =
    needsServers && needsPanes
      ? new CompositeTransport({ panes: socketTransport, servers: a2aTransport! }, (r) => kindOf(r.id))
      : needsServers ? a2aTransport! : socketTransport;

  const broker = makeBroker(transport);

  // The servers runtime's link registers spawned agents with THIS broker.
  const makeServersRuntime = needsServers
    ? () => new ServersRuntime({
        spawner: new NodeProcessSpawner(), engines,
        link: a2aLink(cfg, broker, clock, ids, tokenFor),
      })
    : () => { throw new Error("servers runtime factory called without a servers agent"); };
  // selectRuntime validates server-engine eligibility and builds panes/servers/
  // composite as the team requires; the socket transport's lazy waker now resolves.
  runtime = selectRuntime(cfg, new NodeTmux(), engines, makeServersRuntime);

  // v3 COEXIST (Q1): in direct mode the sender delivers peer-to-peer and the
  // broker only observes. Same-process wiring posts the observer copy in-process;
  // a separate-process agent uses the message/observe socket RPC (BrokerClient).
  let messenger: Messenger | undefined;
  if (cfg.delivery === "direct") {
    messenger = new DirectMessenger({
      directory: registry, router: new Router(registry), endpoints: endpoints!,
      observer: broker, clock, ids,
    });
  }

  const daemon = new BrokerDaemon(broker, new NodeSocketServer());
  const bootstrapper = new Bootstrapper(cfg, {
    runtime, git: new NodeGit(), fs, engines, templates, teamDir,
    register: (card) => broker.register(card),
  });
  return { broker, daemon, bootstrapper, runtime, transport, messenger };
}

/** Compose the `team doctor` collaborators: probe core tools + every known engine command. */
export async function runDoctorCommand(): Promise<{ report: DoctorReport; text: string }> {
  const which = new NodeWhich();
  const engines = resolveEngines({});
  const engineCommands = engines.list().map((e) => e.command);
  const report = await runDoctor({ which, engines: engineCommands });
  return { report, text: formatDoctorReport(report) };
}

export interface InitOptions {
  yes?: boolean;
  out: string;
}

/**
 * Compose the `team init` flow: probe availability via doctor, run the wizard,
 * validate the emitted config against the m1 schema, and write team.yaml.
 * With `--yes`, a ScriptedPrompter feeds the default (solo) preset answers.
 * Returns the written path and validated config plus whether `team up` is wanted.
 */
export async function runInitCommand(
  opts: InitOptions,
  confirmUp: (prompter: Prompter) => Promise<boolean>,
): Promise<{ out: string; wantsUp: boolean }> {
  const which = new NodeWhich();
  const engines = resolveEngines({});

  // availability = which engine commands are on PATH
  const available = new Set<string>();
  for (const e of engines.list()) {
    if (await which.has(e.command)) available.add(e.name);
  }

  const replEngines = engines.list().filter((e) => (e.kind ?? "repl") === "repl");
  const firstAvailable = replEngines.find((e) => available.has(e.name))?.name
    ?? replEngines[0]?.name
    ?? "claude";

  let prompter: Prompter;
  if (opts.yes) {
    // Default preset: solo, panes. Answers: team name, runtime(1=panes), preset(1=solo), engine.
    prompter = new ScriptedPrompter(["team", "1", "1", firstAvailable]);
    // ensure the chosen engine is offerable even if nothing is on PATH (--yes is headless)
    available.add(firstAvailable);
  } else {
    prompter = new NodePrompter();
  }

  const cfg = await runWizard({ prompter, engines, available });
  // Validate against the real m1 schema; throws on invalid.
  TeamConfigSchema.parse(cfg);
  await writeConfigYaml(opts.out, cfg);

  const wantsUp = opts.yes ? false : await confirmUp(prompter);
  if (prompter instanceof NodePrompter) prompter.close();
  return { out: opts.out, wantsUp };
}
