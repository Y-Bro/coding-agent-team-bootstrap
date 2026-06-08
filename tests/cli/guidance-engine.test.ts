import { test } from "node:test";
import assert from "node:assert/strict";
import { EngineGuidanceGenerator } from "../../src/cli/guidance-engine.ts";
import { FakeCommandRunner } from "../../src/ports/command.ts";
import { resolveEngines } from "../../src/engines/registry.ts";

const reg = resolveEngines({
  engines: {
    mine: { command: "mycli", roleFile: "MINE.md", headlessArgs: ["run"] },
    withargs: { command: "mycli", roleFile: "MINE.md", args: ["--model", "x"], headlessArgs: ["run"] },
  },
});
const req = { role: "writer", id: "w", team: "t", engine: "x" };

test("builds argv from command + args + headlessArgs + prompt and returns stdout", async () => {
  const runner = new FakeCommandRunner({ code: 0, stdout: "GUIDE", stderr: "", timedOut: false });
  const g = new EngineGuidanceGenerator(runner, reg, "claude");
  const out = await g.generate(req);
  assert.equal(out, "GUIDE");
  assert.equal(runner.calls[0]!.command, "claude");
  // claude headlessArgs = ["-p"], prompt appended last
  assert.equal(runner.calls[0]!.args[0], "-p");
  assert.ok(runner.calls[0]!.args.at(-1)!.includes("writer"));
});

test("uses a config-defined engine's command + headlessArgs", async () => {
  const runner = new FakeCommandRunner({ code: 0, stdout: "X", stderr: "", timedOut: false });
  const g = new EngineGuidanceGenerator(runner, reg, "mine");
  await g.generate(req);
  assert.equal(runner.calls[0]!.command, "mycli");
  assert.equal(runner.calls[0]!.args[0], "run");
});

test("argv preserves order: profile args, then headlessArgs, then the prompt last", async () => {
  const runner = new FakeCommandRunner({ code: 0, stdout: "X", stderr: "", timedOut: false });
  const g = new EngineGuidanceGenerator(runner, reg, "withargs");
  await g.generate(req);
  const args = runner.calls[0]!.args;
  // exact order: ["--model", "x", "run", "<prompt>"]
  assert.deepEqual(args.slice(0, 3), ["--model", "x", "run"]);
  assert.equal(args.length, 4);
  assert.ok(args.at(-1)!.includes("writer")); // generated prompt is last
});

test("returns null without spawning when generator has no headlessArgs", async () => {
  const runner = new FakeCommandRunner({ code: 0, stdout: "X", stderr: "", timedOut: false });
  const g = new EngineGuidanceGenerator(runner, reg, "gemini"); // gemini: no headlessArgs
  assert.equal(await g.generate(req), null);
  assert.equal(runner.calls.length, 0);
});

test("returns null on non-zero exit, timeout, or empty stdout", async () => {
  const fail = new EngineGuidanceGenerator(
    new FakeCommandRunner({ code: 1, stdout: "x", stderr: "boom", timedOut: false }), reg, "claude");
  assert.equal(await fail.generate(req), null);
  const timeout = new EngineGuidanceGenerator(
    new FakeCommandRunner({ code: null, stdout: "", stderr: "", timedOut: true }), reg, "claude");
  assert.equal(await timeout.generate(req), null);
  const empty = new EngineGuidanceGenerator(
    new FakeCommandRunner({ code: 0, stdout: "   ", stderr: "", timedOut: false }), reg, "claude");
  assert.equal(await empty.generate(req), null);
});

test("returns null when the generator engine is unknown to the registry", async () => {
  const runner = new FakeCommandRunner({ code: 0, stdout: "X", stderr: "", timedOut: false });
  const g = new EngineGuidanceGenerator(runner, reg, "ghost");
  assert.equal(await g.generate(req), null);
  assert.equal(runner.calls.length, 0);
});

test("guidance generation uses a 120s timeout", async () => {
  const runner = new FakeCommandRunner({ code: 0, stdout: "x", stderr: "", timedOut: false });
  const g = new EngineGuidanceGenerator(runner, resolveEngines({}), "claude");
  await g.generate({ role: "r", id: "i", team: "t", engine: "claude" });
  assert.equal(runner.calls[0]!.opts.timeoutMs, 120_000);
});

test("the generation prompt asks the model to stay within the line limit", async () => {
  const runner = new FakeCommandRunner({ code: 0, stdout: "x", stderr: "", timedOut: false });
  const g = new EngineGuidanceGenerator(runner, resolveEngines({}), "claude");
  await g.generate({ role: "r", id: "i", team: "t", engine: "claude" });
  const prompt = runner.calls[0]!.args.at(-1)!; // prompt is the last argv element
  assert.match(prompt, /180/);
  assert.match(prompt, /at most ~180 lines/);
});
