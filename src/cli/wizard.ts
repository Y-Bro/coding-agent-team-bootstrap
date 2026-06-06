// src/cli/wizard.ts
import { stringify } from "yaml";
import { writeFile } from "node:fs/promises";
import type { Prompter } from "../ports/prompter.ts";
import type { EngineRegistry } from "../engines/index.ts";

export interface WizardInput {
  prompter: Prompter;
  engines: EngineRegistry;
  available: Set<string>; // engine names found on PATH (from doctor)
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

export interface WizardConfig {
  name: string;
  agents: { id: string; role: string; engine: string }[];
}

export async function runWizard(input: WizardInput): Promise<WizardConfig> {
  const { prompter, engines, available } = input;
  const name = await prompter.ask("Team name?", "team");

  const presetNames = [...Object.keys(PRESETS), "lead + N writer/reviewer pairs"];
  const presetChoice = await prompter.select("Pick a team shape:", presetNames);

  let baseAgents: PresetAgent[];
  if (presetChoice === "lead + N writer/reviewer pairs") {
    const n = Number(await prompter.ask("How many writer/reviewer pairs?", "1")) || 1;
    baseAgents = [{ id: "lead", role: "lead" }];
    for (let i = 1; i <= n; i++) {
      baseAgents.push({ id: `writer${i}`, role: "writer" });
      baseAgents.push({ id: `reviewer${i}`, role: "reviewer" });
    }
  } else {
    baseAgents = PRESETS[presetChoice] ?? PRESETS["solo"]!;
  }

  const offerable = engines.list()
    .filter((e) => (e.kind ?? "repl") === "repl" && available.has(e.name))
    .map((e) => e.name);
  if (offerable.length === 0) throw new Error("no installed REPL engines found; run `team doctor`");

  const agents: WizardConfig["agents"] = [];
  for (const a of baseAgents) {
    const engine = await prompter.select(`Engine for ${a.id} (${a.role})?`, offerable);
    agents.push({ id: a.id, role: a.role, engine });
  }

  return { name, agents };
}

export async function writeConfigYaml(path: string, cfg: unknown): Promise<void> {
  await writeFile(path, stringify(cfg), "utf8");
}
