import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeCommandRunner, FakeCommandRunner } from "../../src/ports/command.ts";

test("NodeCommandRunner captures stdout and exit code", async () => {
  const r = new NodeCommandRunner();
  const res = await r.run("node", ["-e", "process.stdout.write('hi')"], { timeoutMs: 5000 });
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), "hi");
  assert.equal(res.timedOut, false);
});

test("NodeCommandRunner reports a timeout", async () => {
  const r = new NodeCommandRunner();
  const res = await r.run("node", ["-e", "setTimeout(()=>{}, 10000)"], { timeoutMs: 200 });
  assert.equal(res.timedOut, true);
});

test("FakeCommandRunner returns its scripted result and records the call", async () => {
  const r = new FakeCommandRunner({ code: 0, stdout: "GUIDE", stderr: "", timedOut: false });
  const res = await r.run("claude", ["-p", "prompt"], {});
  assert.equal(res.stdout, "GUIDE");
  assert.deepEqual(r.calls[0], { command: "claude", args: ["-p", "prompt"], opts: {} });
});
