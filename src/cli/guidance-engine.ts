import type { CommandRunner } from "../ports/command.ts";
import type { EngineRegistry } from "../engines/index.ts";
import type { GuidanceGenerator, GuidanceRequest } from "../ports/guidance.ts";

const TIMEOUT_MS = 30_000;

/** Builds the fixed, local generation prompt. No secrets; markdown-only output. */
export function buildGuidancePrompt(req: GuidanceRequest): string {
  return [
    `Write a concise role-guidance section (markdown) for an AI coding agent on a software team.`,
    `The agent's id is "${req.id}", its role is "${req.role}", on team "${req.team}".`,
    `Cover: its core responsibilities, what to focus on, and how it should collaborate with teammates.`,
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
    if (!profile?.headlessArgs) return null;
    const args = [...(profile.args ?? []), ...profile.headlessArgs, buildGuidancePrompt(req)];
    const res = await this.runner.run(profile.command, args, { timeoutMs: TIMEOUT_MS });
    if (res.timedOut || res.code !== 0) return null;
    const out = res.stdout.trim();
    return out.length > 0 ? out : null;
  }
}
