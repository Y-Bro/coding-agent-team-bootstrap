// src/cli/wizard.ts
import { stringify } from "yaml";
import { writeFile } from "node:fs/promises";
import type { Prompter } from "../ports/prompter.ts";
import type { EngineRegistry } from "../engines/index.ts";

export interface WizardInput {
  prompter: Prompter;
  engines: EngineRegistry;
  available: Set<string>; // engine names found on PATH (from doctor)
  /** Surface guidance (e.g. non-server-capable engine in servers mode). Defaults to a no-op. */
  warn?: (message: string) => void;
}

interface PresetAgent { id: string; role: string }

const PRESETS: Record<string, PresetAgent[]> = {
  "solo": [{ id: "agent", role: "writer" }],
  "lead+writer+reviewer": [
    { id: "lead", role: "lead" },
    { id: "writer", role: "writer" },
    { id: "reviewer", role: "reviewer" },
  ],
};

const PAIRS_SHAPE = "lead + N writer/reviewer pairs";
const CUSTOM_SHAPE = "custom (choose count + free-text roles)";

const RUNTIME_CHOICES = [
  "panes (tmux multi-agent orchestration)",
  "servers (A2A HTTP)",
] as const;

export interface ServersBlock {
  host: string;
  basePort: number;
  auth: boolean;
  rateLimit: { maxConcurrency: number; bucketCapacity: number; refillPerSec: number };
}

/** Loopback-safe servers defaults scaffolded when the user picks the servers runtime. */
const SERVERS_DEFAULTS: ServersBlock = {
  host: "127.0.0.1",
  basePort: 41000,
  auth: true,
  rateLimit: { maxConcurrency: 4, bucketCapacity: 8, refillPerSec: 2 },
};

export interface WizardConfig {
  name: string;
  runtime: "panes" | "servers";
  agents: { id: string; role: string; engine: string }[];
  servers?: ServersBlock;
}

export async function runWizard(input: WizardInput): Promise<WizardConfig> {
  const { prompter, engines, available } = input;
  const warn = input.warn ?? (() => {});
  const name = await prompter.ask("Team name?", "team");

  const runtimeChoice = await prompter.select("Runtime?", [...RUNTIME_CHOICES]);
  const runtime: WizardConfig["runtime"] = runtimeChoice.startsWith("servers") ? "servers" : "panes";

  const presetNames = [...Object.keys(PRESETS), PAIRS_SHAPE, CUSTOM_SHAPE];
  const presetChoice = await prompter.select("Pick a team shape:", presetNames);

  const offerable = engines.list()
    .filter((e) => (e.kind ?? "repl") === "repl" && available.has(e.name))
    .map((e) => e.name);
  if (offerable.length === 0) throw new Error("no installed REPL engines found; run `team doctor`");

  const pickEngine = (id: string, role: string) => prompter.select(`Engine for ${id} (${role})?`, offerable);

  const agents: WizardConfig["agents"] = [];
  if (presetChoice === CUSTOM_SHAPE) {
    // Free-form team: any number of agents, each with a free-text role.
    const n = Math.max(1, Number(await prompter.ask("How many agents?", "1")) || 1);
    for (let i = 1; i <= n; i++) {
      const id = await prompter.ask(`Agent ${i} id?`, `agent${i}`);
      const role = await prompter.ask(`Agent ${i} role? (free text, e.g. "cloud architect", "CEO")`, "engineer");
      agents.push({ id, role, engine: await pickEngine(id, role) });
    }
  } else {
    let baseAgents: PresetAgent[];
    if (presetChoice === PAIRS_SHAPE) {
      const n = Number(await prompter.ask("How many writer/reviewer pairs?", "1")) || 1;
      baseAgents = [{ id: "lead", role: "lead" }];
      for (let i = 1; i <= n; i++) {
        baseAgents.push({ id: `writer${i}`, role: "writer" });
        baseAgents.push({ id: `reviewer${i}`, role: "reviewer" });
      }
    } else {
      baseAgents = PRESETS[presetChoice] ?? PRESETS["solo"]!;
    }
    for (const a of baseAgents) {
      agents.push({ id: a.id, role: a.role, engine: await pickEngine(a.id, a.role) });
    }
  }

  if (runtime === "servers") {
    // Scaffold the servers block and guide if a chosen engine can't run as a server.
    for (const a of agents) {
      if ((engines.get(a.engine)?.kind ?? "repl") !== "server") {
        warn(`engine '${a.engine}' for agent '${a.id}' is not server-capable (kind:"repl"); define a kind:"server" engine profile in the engines: block before \`team up\``);
      }
    }
    return { name, runtime, agents, servers: { ...SERVERS_DEFAULTS, rateLimit: { ...SERVERS_DEFAULTS.rateLimit } } };
  }

  return { name, runtime, agents };
}

export async function writeConfigYaml(path: string, cfg: unknown): Promise<void> {
  await writeFile(path, stringify(cfg), "utf8");
}
