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
import { resolveEngines } from "./engines/index.ts";
import { NodeWhich } from "./ports/which.ts";
import { NodePrompter, ScriptedPrompter, type Prompter } from "./ports/prompter.ts";
import { runDoctor, type DoctorReport } from "./bootstrap/doctor.ts";
import { runWizard, writeConfigYaml } from "./cli/wizard.ts";
import { formatDoctorReport } from "./cli/doctor-cmd.ts";
import { TeamConfigSchema } from "./config/schema.ts";

export function buildContainer(cfg: TeamConfig, templates: Record<string, string>) {
  const fs = new NodeFileSystem();
  const registry = new AgentRegistry();
  const engines = resolveEngines(cfg);
  const runtime: Runtime = selectRuntime(cfg, new NodeTmux(), engines);

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
  const bootstrapper = new Bootstrapper(cfg, { runtime, git: new NodeGit(), fs, engines, templates });
  return { broker, daemon, bootstrapper, runtime };
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
