import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProgram } from "../../src/client/cli.ts";

function fakeClient() {
  const calls: any[] = [];
  return {
    calls,
    send: async (p: any) => { calls.push(["send", p]); return { id: "m1" }; },
    inbox: async (id: string) => { calls.push(["inbox", id]); return [{ id: "m1", from: "a", type: "note", parts: [{ kind: "text", text: "hi" }] }]; },
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
});
