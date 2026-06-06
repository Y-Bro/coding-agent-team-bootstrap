// src/bootstrap/doctor.ts
import type { CommandLocator } from "../ports/which.ts";

export interface DoctorInput {
  which: CommandLocator;
  engines: string[];        // engine command names to probe for availability
}

export interface DoctorReport {
  ok: boolean;                              // false if any blocker
  blockers: string[];                       // missing core tools
  enginesPresent: Record<string, boolean>; // per engine command
}

const CORE = ["tmux", "git", "node"];

export async function runDoctor(input: DoctorInput): Promise<DoctorReport> {
  const blockers: string[] = [];
  for (const tool of CORE) {
    if (!(await input.which.has(tool))) {
      blockers.push(`missing required tool: ${tool} (install it and re-run)`);
    }
  }
  const enginesPresent: Record<string, boolean> = {};
  for (const e of input.engines) enginesPresent[e] = await input.which.has(e);
  return { ok: blockers.length === 0, blockers, enginesPresent };
}
