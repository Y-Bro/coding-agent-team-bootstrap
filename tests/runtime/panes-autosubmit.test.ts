import { test } from "node:test";
import assert from "node:assert/strict";
import { PanesRuntime } from "../../src/runtime/panes.ts";

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
// Minimal fake sleeper recording sleep order relative to tmux send-keys calls.
function fakes() {
  const tmux = new FakeTmux();
  const events: string[] = [];
  const sleeper = { sleep: async (_ms: number) => { events.push("sleep"); } };
  const origRun = tmux.run.bind(tmux);
  tmux.run = (args: string[]) => {
    if (args[0] === "send-keys") events.push("send-keys:" + (args.includes("Enter") ? "enter" : "text"));
    return origRun(args);
  };
  return { tmux, sleeper, events };
}

test("wake types text, sleeps, then sends Enter separately", async () => {
  const { tmux, sleeper, events } = fakes();
  // PanesRuntime(tmux, session, engines, sleeper) — match the real constructor order
  const rt = new PanesRuntime(tmux as any, "s", { get: () => undefined, list: () => [] } as any, sleeper as any);
  await rt.wake("lead", "new mail");
  const idx = (s: string) => events.indexOf(s);
  assert.ok(events.includes("send-keys:text"));
  assert.ok(events.includes("send-keys:enter"));
  assert.ok(idx("send-keys:text") < idx("sleep"));
  assert.ok(idx("sleep") < idx("send-keys:enter"));
});
