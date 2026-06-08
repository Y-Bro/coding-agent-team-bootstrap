// src/engines/registry.ts
import type { EngineProfile } from "./profile.ts";

export const BUILTIN_ENGINES: EngineProfile[] = [
  { name: "claude",       command: "claude",       roleFile: "CLAUDE.md",      kind: "repl", headlessArgs: ["-p"] },
  { name: "codex",        command: "codex",        roleFile: "AGENTS.md",      kind: "repl", headlessArgs: ["exec"] },
  { name: "cursor-agent", command: "cursor-agent", roleFile: "AGENTS.md",      kind: "repl", headlessArgs: ["-p"] },
  { name: "opencode",     command: "opencode",     roleFile: "AGENTS.md",      kind: "repl" },
  { name: "gemini",       command: "gemini",       roleFile: "GEMINI.md",      kind: "repl" },
  { name: "aider",        command: "aider",        roleFile: "CONVENTIONS.md", kind: "repl" },
];

export interface EngineRegistry {
  get(name: string): EngineProfile | undefined;
  list(): EngineProfile[];
}

// Minimal shape of config this needs; full TeamConfig type lives in config/schema.ts.
export interface EnginesConfig {
  engines?: Record<string, Omit<EngineProfile, "name">>;
}

export function resolveEngines(config: EnginesConfig): EngineRegistry {
  const map = new Map<string, EngineProfile>();
  for (const e of BUILTIN_ENGINES) map.set(e.name, e);
  for (const [name, p] of Object.entries(config.engines ?? {})) {
    map.set(name, { name, kind: "repl", ...p });
  }
  return {
    get: (name) => map.get(name),
    list: () => [...map.values()],
  };
}
