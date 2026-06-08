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
import { staticDiscoveryFromConfig, stampUrl, type DiscoveryProvider } from "./a2a/discovery.ts";
import { BrokerAuthProvider, InProcessSecret, bearerHeader } from "./a2a/http/auth.ts";
import { randomBytes } from "node:crypto";
import { throwIfRateLimited } from "./a2a/http/ratelimit.ts";
import { NodeHttpClient, NodeHttpServer, type TlsClientOptions } from "./ports/http.ts";
import { MemoryBus } from "./broker/bus.ts";
import { TaskMachine } from "./broker/tasks.ts";
import { TaskProjector } from "./broker/task-projector.ts";
import { SweepLoop } from "./broker/sweep.ts";
import { StallPolicy } from "./broker/policies/stall.ts";
import { DeadLetterPolicy } from "./broker/policies/dead-letter.ts";
import { DashboardServer } from "./dashboard/server.ts";
import type { AgentCard, Message } from "./a2a/index.ts";
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
import { LayoutPlanner } from "./cli/layout-planner.ts";
import { ContextScaffolder, type ScaffoldAgent } from "./cli/context-scaffolder.ts";
import { EngineGuidanceGenerator } from "./cli/guidance-engine.ts";
import { NodeCommandRunner, type CommandRunner } from "./ports/command.ts";
import type { GuidanceGenerator } from "./ports/guidance.ts";
import { dirname, join } from "node:path";

type TokenFor = (agentId: string) => string | undefined;

function makeBus(kind: "memory"): MemoryBus {
  switch (kind) {
    case "memory": return new MemoryBus();
    default: throw new Error(`unknown bus.kind: ${kind as string}`);
  }
}

/** The recipient's reachable A2A base URL: its advertised card url, else discovery (config). */
function urlOf(discovery: DiscoveryProvider, recipient: AgentCard): string {
  const url = recipient.url ?? discovery.resolve(recipient.id);
  if (!url) throw new Error(`no reachable A2A URL for agent ${recipient.id}`);
  return url;
}

/** Build the A2A endpoint resolver: one A2AClient per agent (its bearer + the resolved url). */
function a2aEndpoints(discovery: DiscoveryProvider, tokenFor?: TokenFor, clientTls?: TlsClientOptions): A2AEndpoints {
  const http = new NodeHttpClient(clientTls);
  return {
    clientFor: (recipient) => new A2AClient(http, urlOf(discovery, recipient), tokenFor?.(recipient.id)),
  };
}

/** Push-webhook sender: POST the message to each recipient's resolved webhook (with its bearer). */
function a2aWebhook(discovery: DiscoveryProvider, tokenFor?: TokenFor, clientTls?: TlsClientOptions): WebhookSender {
  const http = new NodeHttpClient(clientTls);
  return {
    push: async (recipient, message) => {
      const token = tokenFor?.(recipient.id);
      const res = await http.request(`${urlOf(discovery, recipient)}/webhook`, {
        method: "POST", body: JSON.stringify(message),
        headers: token !== undefined ? bearerHeader(token) : undefined,
      });
      throwIfRateLimited(res); // a 429 from the agent webhook drives scheduler backoff
    },
  };
}

/**
 * The servers-mode link: register a spawned agent with the in-process broker
 * (broker-mediated, per Q2), stamping its reachable url, and notify it of waiting
 * mail by pushing a status message to its A2A endpoint.
 */
function a2aLink(discovery: DiscoveryProvider, broker: Broker, clock: SystemClock, ids: UuidGenerator, tokenFor?: TokenFor, clientTls?: TlsClientOptions): AgentLink {
  const endpoints = a2aEndpoints(discovery, tokenFor, clientTls);
  return {
    register: async (card) => { broker.register(stampUrl(discovery, card)); },
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
  const store = new JsonlStore(fs, join(teamDir, "messages.jsonl"));
  // Observer fan-out is ALWAYS constructed (config-selected) so task projection
  // and sweep work headless; the dashboard becomes one more subscriber.
  const bus = makeBus(cfg.bus.kind);
  const makeBroker = (transport: Transport): Broker => new Broker({
    store,
    registry,
    router: new Router(registry),
    feed: new FeedRenderer(fs, join(teamDir, "feed.md")),
    transport,
    clock,
    ids,
    publisher: bus,
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

  // v3-m3 multi-host: agents are reachable at config-resolved URLs (Agent Cards
  // advertise them). DiscoveryProvider is the resolution seam (static default).
  const discovery = staticDiscoveryFromConfig(cfg);
  // Opt-in TLS: trust the configured CA (self-signed → the cert itself) on
  // outbound A2A calls. Server-side TLS material is consumed by agent processes.
  const tls = cfg.servers.tls;
  const clientTls: TlsClientOptions | undefined = tls
    ? { ca: tls.ca ? fs.read(tls.ca) : fs.read(tls.cert) }
    : undefined;

  // Servers-side A2A wiring, built only when some agent runs on servers. Broker
  // mediates token issuance (one bearer per agent, Q5); one shared FleetScheduler
  // bounds the fleet's concurrent model-triggering deliveries (Q4).
  let endpoints: A2AEndpoints | undefined;
  let a2aTransport: A2ATransport | undefined;
  let tokenFor: TokenFor = () => undefined;
  if (needsServers) {
    // Bearer auth with opt-in hardening (Q5): expiry from servers.tokenTtlSec and
    // an HMAC signing secret (configured, else a freshly-generated in-process one
    // — never hardcoded). No knobs → exact v2 bearer behavior.
    const secret = new InProcessSecret(cfg.servers.secret ?? randomBytes(32).toString("hex"));
    const ttlMs = cfg.servers.tokenTtlSec !== undefined ? cfg.servers.tokenTtlSec * 1000 : undefined;
    const auth = cfg.servers.auth ? new BrokerAuthProvider(ids, { clock, secret, ttlMs }) : undefined;
    const tokens = new Map(auth ? cfg.agents.map((a) => [a.id, auth.issueToken(a.id)] as const) : []);
    tokenFor = (id) => tokens.get(id);
    const scheduler = new FleetScheduler({ clock, sleeper: new RealSleeper(), config: cfg.servers.rateLimit });
    endpoints = a2aEndpoints(discovery, tokenFor, clientTls);
    a2aTransport = new A2ATransport(endpoints, a2aWebhook(discovery, tokenFor, clientTls), scheduler);
  }

  // Single matching transport per kind; a mixed team bridges socket<->A2A by
  // recipient runtime (Q2) so pane and server agents exchange messages both ways.
  const transport: Transport =
    needsServers && needsPanes
      ? new CompositeTransport({ panes: socketTransport, servers: a2aTransport! }, (r) => kindOf(r.id))
      : needsServers ? a2aTransport! : socketTransport;

  const broker = makeBroker(transport);

  // Task projection: derive A2A task state from real traffic by observing the bus
  // (observer only, never in the delivery path). rebuild() restores state from the
  // persisted task_status log before live events flow.
  const taskMachine = new TaskMachine(store, clock, ids);
  const taskProjector = new TaskProjector(taskMachine);
  bus.subscribe((m) => taskProjector.handle(m));
  taskMachine.rebuild();

  // Liveness sweep: one Clock/Sleeper loop, two policies. `emit` appends to the
  // log AND publishes to the bus so flags/escalations are durable and observable.
  const emit = (m: Message) => { store.append(m); void bus.publish(m); };
  const isoOf = (d: Date) => d.toISOString();
  const lead = cfg.agents[0]!.id; // convention: first agent is the lead/owner of escalations
  const sweep = new SweepLoop({
    clock, sleeper: new RealSleeper(), intervalMs: cfg.timers.sweepIntervalMs,
    policies: [
      new StallPolicy({ store, stallMs: cfg.timers.stallMs, waker: { wake: (id, s) => runtime.wake(id, s) }, emit, ids, isoOf }),
      new DeadLetterPolicy({ store, deadLetterMs: cfg.timers.deadLetterMs, lead, emit, ids, isoOf }),
    ],
  });

  // The servers runtime's link registers spawned agents with THIS broker.
  const makeServersRuntime = needsServers
    ? () => new ServersRuntime({
        spawner: new NodeProcessSpawner(), engines,
        link: a2aLink(discovery, broker, clock, ids, tokenFor, clientTls),
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
    // Stamp the reachable url once; the bootstrapper uses the same stamped card
    // for the broker registration, the on-disk .team/cards/<id>.json, and spawn.
    stampCard: (card) => stampUrl(discovery, card),
    register: (card) => broker.register(card),
  });

  // Opt-in read-only dashboard, served from the broker process on its own port.
  let dashboard: { server: DashboardServer; port: number } | undefined;
  if (cfg.dashboard.enabled) {
    const server = new DashboardServer({ server: new NodeHttpServer(), store, registry, subscriber: bus });
    server.register();
    dashboard = { server, port: cfg.dashboard.port };
  }

  // `bus` is exposed from the composition root so the always-on observer seam is
  // assertable (it is constructed regardless of dashboard.enabled).
  return { broker, daemon, bootstrapper, runtime, transport, messenger, dashboard, taskMachine, bus, sweep };
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

export interface ScaffoldOptions {
  out: string;
  noGuidance?: boolean;
  /** Overwrite an existing config unconditionally (skips the overwrite prompt). */
  force?: boolean;
}

interface ScaffoldDeps {
  prompter?: Prompter;
  runner?: CommandRunner;
}

const NULL_GUIDANCE: GuidanceGenerator = { async generate() { return null; } };

/**
 * Compose the `team new` flow: probe availability, run the wizard, plan windows/
 * layout, write team.yaml (root: "."), then write per-engine context files
 * (generated guidance + wiring, or wiring-only on failure). Optionally `team up`.
 *
 * For headless tests an injected `prompter` (scripted) + `runner` (fake) keep the
 * whole flow off the real shell; the default path constructs NodePrompter +
 * NodeCommandRunner. When a prompter is injected, every repl engine is offerable
 * (the caller's scripted answers pick the engine) so the flow never depends on
 * which CLIs happen to be on PATH.
 */
export async function runScaffoldCommand(opts: ScaffoldOptions, deps: ScaffoldDeps = {}): Promise<{ out: string }> {
  const which = new NodeWhich();
  const engines = resolveEngines({});
  const replEngines = engines.list().filter((e) => (e.kind ?? "repl") === "repl");

  const prompter = deps.prompter ?? new NodePrompter();
  const runner = deps.runner ?? new NodeCommandRunner();
  const fs = new NodeFileSystem();

  // Overwrite guard: never clobber an existing config silently. --force overwrites
  // unconditionally; otherwise prompt (default NO) and on "no" abort the whole
  // scaffold — write nothing and skip context files. (`team new --yes` keeps an
  // existing config by short-circuiting in bin before we get here.)
  if (fs.exists(opts.out) && !opts.force) {
    const overwrite = await prompter.confirm(`${opts.out} already exists — overwrite it?`, false);
    if (!overwrite) {
      if (prompter instanceof NodePrompter) prompter.close();
      console.log(`Kept existing ${opts.out}; nothing written.`);
      return { out: opts.out };
    }
  }

  // Interactive: offer only engines on PATH (+ a guaranteed first choice).
  // Headless (injected prompter): offer every repl engine so scripted answers work.
  const available = new Set<string>();
  if (deps.prompter) {
    for (const e of replEngines) available.add(e.name);
  } else {
    for (const e of engines.list()) if (await which.has(e.command)) available.add(e.name);
    const firstAvailable = replEngines.find((e) => available.has(e.name))?.name ?? replEngines[0]?.name ?? "claude";
    available.add(firstAvailable);
  }

  // 1) team shape + engines
  const wiz = await runWizard({ prompter, engines, available });

  // 2) windows + layout
  const plan = await new LayoutPlanner(prompter).plan(
    wiz.agents.map((a) => ({ id: a.id, role: a.role, engine: a.engine })),
  );

  // 3) assemble config (fills existing window/layout fields; root anchors here)
  const cfg: Record<string, unknown> = {
    ...wiz,
    root: ".",
    agents: wiz.agents.map((a) => ({ ...a, window: plan.windowByAgent[a.id] })),
    layout: plan.layoutByWindow,
  };
  const parsed = TeamConfigSchema.parse(cfg); // validate before writing; capture defaults
  await writeConfigYaml(opts.out, cfg);

  // 4) context files
  const base = dirname(opts.out);
  // Source the generator engine from the validated config (default "claude"),
  // not a hardcoded literal — so scaffold.generator drives guidance generation.
  const generator: GuidanceGenerator = opts.noGuidance
    ? NULL_GUIDANCE
    : new EngineGuidanceGenerator(runner, engines, parsed.scaffold.generator);
  const scaffoldAgents: ScaffoldAgent[] = wiz.agents.map((a) => ({
    id: a.id, role: a.role, engine: a.engine, subscribes: [],
  }));
  await new ContextScaffolder(fs, generator, engines, (m) => console.warn(m))
    .scaffold(wiz.name, scaffoldAgents, base);

  // 5) optional bring-up
  const up = await prompter.confirm("Bring the team up now?", false);
  if (prompter instanceof NodePrompter) prompter.close();
  if (up) console.log(`Run \`TEAM_CONFIG=${opts.out} team up\` to start the team.`);
  return { out: opts.out };
}
