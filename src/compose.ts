import type { TeamConfig } from "./config/index.ts";
import { Broker } from "./broker/broker.ts";
import { JsonlStore } from "./broker/store.ts";
import { AgentRegistry } from "./broker/registry.ts";
import { Router } from "./broker/router.ts";
import { FeedRenderer } from "./broker/feed.ts";
import { BrokerDaemon } from "./broker/daemon.ts";
import { SocketTransport, type Transport } from "./broker/transport.ts";
import { A2ATransport, type A2AEndpoints, type WebhookSender } from "./broker/a2a-transport.ts";
import { A2AClient } from "./a2a/http/index.ts";
import { BrokerAuthProvider, bearerHeader } from "./a2a/http/auth.ts";
import { throwIfRateLimited } from "./a2a/http/ratelimit.ts";
import { NodeHttpClient } from "./ports/http.ts";
import { selectRuntime } from "./runtime/select.ts";
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
  const makeBroker = (transport: Transport): Broker => new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry,
    router: new Router(registry),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    transport,
    clock,
    ids,
  });

  let runtime: Runtime;
  let transport: Transport;
  let broker: Broker;

  if (cfg.runtime === "servers") {
    // servers: A2A transport needs no runtime, so build broker first, then the
    // ServersRuntime whose link registers with that broker. selectRuntime
    // validates kind:"server" eligibility before the factory runs.
    // Broker mediates issuance: one bearer token per agent (Q5, localhost scope).
    // Auth is on by default but can be disabled via the servers block.
    const auth = cfg.servers.auth ? new BrokerAuthProvider(ids) : undefined;
    const tokens = new Map(auth ? cfg.agents.map((a) => [a.id, auth.issueToken(a.id)] as const) : []);
    const tokenFor: TokenFor = (id) => tokens.get(id);
    // One scheduler shared across the fleet bounds concurrent model-triggering
    // deliveries against the upstream rate-limit pool (Q4); knobs from config.
    const scheduler = new FleetScheduler({ clock, sleeper: new RealSleeper(), config: cfg.servers.rateLimit });
    transport = new A2ATransport(a2aEndpoints(cfg, tokenFor), a2aWebhook(cfg, tokenFor), scheduler);
    broker = makeBroker(transport);
    const link = a2aLink(cfg, broker, clock, ids, tokenFor);
    runtime = selectRuntime(cfg, new NodeTmux(), engines,
      () => new ServersRuntime({ spawner: new NodeProcessSpawner(), engines, link }));
  } else {
    // panes: SocketTransport wraps the runtime, so build the runtime first.
    runtime = selectRuntime(cfg, new NodeTmux(), engines,
      () => { throw new Error("servers runtime factory called in panes mode"); });
    transport = new SocketTransport(runtime);
    broker = makeBroker(transport);
  }

  const daemon = new BrokerDaemon(broker, new NodeSocketServer());
  const bootstrapper = new Bootstrapper(cfg, { runtime, git: new NodeGit(), fs, engines, templates });
  return { broker, daemon, bootstrapper, runtime, transport };
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
    // Default preset: solo. Answers: team name, preset(1=solo), engine for the agent.
    prompter = new ScriptedPrompter(["team", "1", firstAvailable]);
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
