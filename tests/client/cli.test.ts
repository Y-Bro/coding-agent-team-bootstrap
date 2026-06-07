import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProgram } from "../../src/client/cli.ts";

function fakeClient() {
  const calls: any[] = [];
  return {
    calls,
    send: async (p: any) => { calls.push(["send", p]); return { id: "m1" }; },
    peek: async (id: string) => { calls.push(["peek", id]); return [{ id: "m1", from: "a", type: "note", parts: [{ kind: "text", text: "hi" }] }]; },
    ack: async (id: string, ids: string[]) => { calls.push(["ack", id, ids]); },
    list: async () => { calls.push(["list"]); return [{ id: "a", role: "writer" }]; },
    register: async () => {},
  };
}

test("`send` forwards to client.send with parsed flags", async () => {
  const client = fakeClient();
  const out: string[] = [];
  const program = buildProgram(client as any, "fe-writer", (s) => out.push(s));
  await program.parseAsync(["send", "--to", "fe-reviewer", "--type", "review_request", "slice 4"], { from: "user" });
  assert.deepEqual(client.calls[0], ["send", { from: "fe-writer", to: "fe-reviewer", type: "review_request", parts: [{ kind: "text", text: "slice 4" }], task: undefined }]);
});

test("`inbox` prints drained messages", async () => {
  const client = fakeClient();
  const out: string[] = [];
  const program = buildProgram(client as any, "fe-reviewer", (s) => out.push(s));
  await program.parseAsync(["inbox"], { from: "user" });
  assert.match(out.join("\n"), /note.*hi/s);
  // peek-then-ack: the printed message is acked by id
  assert.deepEqual(client.calls.find((c) => c[0] === "ack"), ["ack", "fe-reviewer", ["m1"]]);
});
