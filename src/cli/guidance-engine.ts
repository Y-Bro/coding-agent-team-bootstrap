import type { CommandRunner } from "../ports/command.ts";
import type { EngineRegistry } from "../engines/index.ts";
import type { GuidanceGenerator, GuidanceRequest } from "../ports/guidance.ts";
import { trace } from "../obs/trace.ts";

const TIMEOUT_MS = 120_000;

/** Builds the fixed, local generation prompt. No secrets; markdown-only output. */
export function buildGuidancePrompt(req: GuidanceRequest): string {
  return [
    `Write a concise role-guidance section (markdown) for an AI coding agent on a software team.`,
    `The agent's id is "${req.id}", its role is "${req.role}", on team "${req.team}".`,
    `Cover: its core responsibilities, what to focus on, and how it should collaborate with teammates.`,
    `Keep it concise: at most ~180 lines of markdown.`,
    `Output only the markdown body. Do not include a code fence around the whole thing.`,
    `Make no file changes and run no shell commands — only print the markdown.`,
  ].join("\n");
}

export class EngineGuidanceGenerator implements GuidanceGenerator {
  constructor(
    private runner: CommandRunner,
    private engines: EngineRegistry,
    private generatorEngine: string,
  ) {}

  async generate(req: GuidanceRequest): Promise<string | null> {
    const profile = this.engines.get(this.generatorEngine);
    if (!profile?.headlessArgs) {
      trace("guidance", `engine '${this.generatorEngine}' has no headlessArgs → null (caller falls back to wiring-only)`);
      return null;
    }
    const args = [...(profile.args ?? []), ...profile.headlessArgs, buildGuidancePrompt(req)];
    trace("guidance", `spawn ${profile.command} (timeout=${TIMEOUT_MS}ms) for ${req.id}/${req.role}`);
    const res = await this.runner.run(profile.command, args, { timeoutMs: TIMEOUT_MS });
    if (res.timedOut || res.code !== 0) {
      trace("guidance", `${req.id}: ${res.timedOut ? "timed out" : `exit ${res.code}`} → null`);
      return null;
    }
    const out = res.stdout.trim();
    trace("guidance", `${req.id}: ${out.length} chars guidance`);
    return out.length > 0 ? out : null;
  }
}
