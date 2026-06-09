import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProgram } from "../../src/client/cli.ts";
import { buildWiringFooter, type ScaffoldAgent } from "../../src/cli/context-scaffolder.ts";

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

test("`send` accepts --text (matches bootstrap + scaffolded guidance)", async () => {
  const client = fakeClient();
  const program = buildProgram(client as any, "me", () => {});
  await program.parseAsync(["send", "--to", "lead", "--type", "status", "--text", "all good"], { from: "user" });
  const sent = client.calls.find((c) => c[0] === "send")![1];
  assert.equal(sent.to, "lead");
  assert.equal(sent.type, "status");
  assert.deepEqual(sent.parts, [{ kind: "text", text: "all good" }]);
});

test("`send` still accepts a positional body", async () => {
  const client = fakeClient();
  const program = buildProgram(client as any, "me", () => {});
  await program.parseAsync(["send", "--to", "lead", "--type", "note", "hello"], { from: "user" });
  const sent = client.calls.find((c) => c[0] === "send")![1];
  assert.deepEqual(sent.parts, [{ kind: "text", text: "hello" }]);
});

test("`send` with BOTH a positional body and --text is rejected", async () => {
  const client = fakeClient();
  const program = buildProgram(client as any, "me", () => {});
  await assert.rejects(
    () => program.parseAsync(["send", "--to", "lead", "--type", "note", "hello", "--text", "world"], { from: "user" }),
    /once/,
  );
  assert.equal(client.calls.filter((c) => c[0] === "send").length, 0, "nothing sent on a guard violation");
});

test("`send` with NEITHER a positional body nor --text is rejected", async () => {
  const client = fakeClient();
  const program = buildProgram(client as any, "me", () => {});
  await assert.rejects(
    () => program.parseAsync(["send", "--to", "lead", "--type", "note"], { from: "user" }),
    /text required/,
  );
  assert.equal(client.calls.filter((c) => c[0] === "send").length, 0, "nothing sent on a guard violation");
});

// Anti-drift: every `team send` snippet the scaffolder writes into agent guidance
// must parse against the REAL CLI. We render an actual footer, extract its literal
// `team send ... --text "..."` lines, and run each through buildProgram — not a
// hand-written lookalike — so guidance and CLI cannot silently drift apart.
test("generated wiring-footer `team send` examples parse against the real CLI", async () => {
  const all: ScaffoldAgent[] = [
    { id: "lead", role: "orchestrator", engine: "claude" },
    { id: "fe-writer", role: "writer", engine: "claude" },
  ];
  // Render both a hub footer (task_assignment/ruling examples) and a spoke footer
  // (status/escalation examples) so every example branch is covered.
  const footers = [
    buildWiringFooter("demo", all[0]!, all),
    buildWiringFooter("demo", all[1]!, all),
  ].join("\n");

  // Pull every `team send ...` command out of its backtick span.
  const commands = [...footers.matchAll(/`(team send [^`]*)`/g)].map((m) => m[1]!);
  assert.ok(commands.length >= 4, `expected several team send examples, got ${commands.length}`);

  // Shell-ish tokenizer: keep double-quoted segments (e.g. --text "...") whole.
  const tokenize = (cmd: string): string[] => {
    const out: string[] = [];
    for (const m of cmd.matchAll(/"([^"]*)"|(\S+)/g)) out.push(m[1] !== undefined ? m[1] : m[2]!);
    return out;
  };

  for (const cmd of commands) {
    const tokens = tokenize(cmd);
    assert.equal(tokens[0], "team");
    const argv = tokens.slice(1); // drop the program name
    const client = fakeClient();
    const program = buildProgram(client as any, "me", () => {});
    await program.parseAsync(argv, { from: "user" }); // must not throw
    const sent = client.calls.find((c) => c[0] === "send")![1];
    const toIdx = argv.indexOf("--to");
    const typeIdx = argv.indexOf("--type");
    assert.equal(sent.from, "me");
    assert.equal(sent.to, argv[toIdx + 1]);
    assert.equal(sent.type, argv[typeIdx + 1]);
    assert.deepEqual(sent.parts, [{ kind: "text", text: "..." }]);
  }
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
