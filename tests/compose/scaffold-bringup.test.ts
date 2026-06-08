import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScaffoldCommand } from "../../src/compose.ts";
import { ScriptedPrompter } from "../../src/ports/prompter.ts";
import { FakeCommandRunner } from "../../src/ports/command.ts";

const runner = () => new FakeCommandRunner({ code: 0, stdout: "G", stderr: "", timedOut: false });

/** Run with console.log captured. Returns the command result and the logged lines. */
async function withCapturedLog<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.log = orig;
  }
}

test("confirm 'y' → wantsUp true (no hint printed)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scaffold-up-"));
  const out = join(dir, "team.yaml");
  // solo wizard: name, runtime(1), preset(1), engine, window(agent), confirm-up=y
  const prompter = new ScriptedPrompter(["demo", "1", "1", "claude", "agent", "y"]);
  const { result, logs } = await withCapturedLog(() =>
    runScaffoldCommand({ out, noGuidance: true }, { prompter, runner: runner() }));
  assert.equal(result.wantsUp, true);
  assert.ok(!logs.some((l) => l.includes("team up")), "no startup hint when starting the team");
});

test("confirm 'n' → wantsUp false AND the actionable hint is emitted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scaffold-up-"));
  const out = join(dir, "team.yaml");
  const prompter = new ScriptedPrompter(["demo", "1", "1", "claude", "agent", "n"]);
  const { result, logs } = await withCapturedLog(() =>
    runScaffoldCommand({ out, noGuidance: true }, { prompter, runner: runner() }));
  assert.equal(result.wantsUp, false);
  assert.ok(logs.some((l) => l.includes(`Run \`TEAM_CONFIG=${out} team up\` to start the team.`)), logs.join("\n"));
});

test("--yes → wantsUp false (never auto-ups) AND the hint is emitted, with no confirm prompt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scaffold-up-"));
  const out = join(dir, "team.yaml");
  // no trailing confirm answer: opts.yes short-circuits the bring-up prompt
  const prompter = new ScriptedPrompter(["demo", "1", "1", "claude", "agent"]);
  const { result, logs } = await withCapturedLog(() =>
    runScaffoldCommand({ out, yes: true, noGuidance: true }, { prompter, runner: runner() }));
  assert.equal(result.wantsUp, false);
  assert.ok(logs.some((l) => l.includes(`Run \`TEAM_CONFIG=${out} team up\` to start the team.`)), logs.join("\n"));
});
