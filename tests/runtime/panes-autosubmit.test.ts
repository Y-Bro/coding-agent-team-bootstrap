import { test } from "node:test";
import assert from "node:assert/strict";
import { PanesRuntime } from "../../src/runtime/panes.ts";
import { resolveEngines } from "../../src/engines/index.ts";

// Records tmux argv in order. new-session/new-window/split-window must return an
// id so placePane works; everything else returns "".
class FakeTmux {
  calls: string[][] = [];
  run(args: string[]): string {
    this.calls.push(args);
    const verb = args[0];
    if (verb === "new-session" || verb === "new-window") return "@1 %1";
    if (verb === "split-window") return "%2";
    return "";
  }
}
// Minimal fakes recording sleep order + delay relative to tmux send-keys calls.
function fakes() {
  const tmux = new FakeTmux();
  const events: string[] = [];
  const sleeps: number[] = [];
  const sleeper = { sleep: async (ms: number) => { sleeps.push(ms); events.push("sleep"); } };
  const origRun = tmux.run.bind(tmux);
  tmux.run = (args: string[]) => {
    if (args[0] === "send-keys") events.push("send-keys:" + (args.includes("Enter") ? "enter" : "text"));
    return origRun(args);
  };
  return { tmux, sleeper, events, sleeps };
}

test("wake types text, sleeps 400ms, then sends Enter separately", async () => {
  const { tmux, sleeper, events, sleeps } = fakes();
  // PanesRuntime(tmux, session, engines, sleeper) — match the real constructor order
  const rt = new PanesRuntime(tmux as any, "s", { get: () => undefined, list: () => [] } as any, sleeper as any);
  await rt.wake("lead", "new mail");
  const idx = (s: string) => events.indexOf(s);
  assert.ok(events.includes("send-keys:text"));
  assert.ok(events.includes("send-keys:enter"));
  assert.ok(idx("send-keys:text") < idx("sleep"));
  assert.ok(idx("sleep") < idx("send-keys:enter"));
  assert.deepEqual(sleeps, [400]); // the configured SUBMIT_DELAY_MS
});

test("spawn (launch) types the launch command, sleeps 400ms, then sends Enter separately", async () => {
  const { tmux, sleeper, events, sleeps } = fakes();
  const rt = new PanesRuntime(tmux as any, "s", resolveEngines({}), sleeper as any);
  const card = {
    id: "lead", role: "lead", cli: "claude", engine: "claude",
    capabilities: [], skills: [], workdir: ".", subscribes: [],
  };
  const ctx = { config: { agents: [{ id: "lead" }], layout: {} }, socketPath: "/tmp/s.sock" };
  await rt.spawn(card as any, ctx as any);

  // same discipline for the launch command: text -> sleep -> Enter, separate calls
  const idx = (s: string) => events.indexOf(s);
  assert.ok(events.includes("send-keys:text"));
  assert.ok(events.includes("send-keys:enter"));
  assert.ok(idx("send-keys:text") < idx("sleep"));
  assert.ok(idx("sleep") < idx("send-keys:enter"));
  // launch: type -> 400ms -> Enter, then 1500ms settle, then bootstrap: type -> 400ms -> Enter
  assert.deepEqual(sleeps, [400, 1500, 400]);

  // the launch command rode in the FIRST literal-text (-l) send-keys, NOT the Enter call
  const sends = tmux.calls.filter((c) => c[0] === "send-keys");
  const textSend = sends.find((c) => c.includes("-l"))!;
  const enterSend = sends.find((c) => c.includes("Enter"))!;
  assert.ok(textSend.join(" ").includes("claude"), "launch command typed literally");
  assert.ok(!enterSend.join(" ").includes("claude"), "Enter is a separate, text-free send-keys");
});
