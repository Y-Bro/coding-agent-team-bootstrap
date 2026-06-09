import { test } from "node:test";
import assert from "node:assert/strict";
import { JsonlStore } from "../../src/broker/store.ts";
import { MemoryFs } from "../ports/fakes.ts";
import type { Message } from "../../src/a2a/index.ts";

const msg = (id: string): Message => ({
  id, from: "a", to: "b", type: "note",
  parts: [{ kind: "text", text: id }], ts: "2026-06-06T00:00:00.000Z",
});

test("append writes one JSONL line per message and replay rebuilds order", () => {
  const fs = new MemoryFs();
  const store = new JsonlStore(fs, ".team/messages.jsonl");
  store.append(msg("m1"));
  store.append(msg("m2"));
  const all = store.replay();
  assert.deepEqual(all.map((m) => m.id), ["m1", "m2"]);
});

test("replay skips a corrupt JSONL line and returns the valid messages", () => {
  const fs = new MemoryFs();
  const path = ".team/messages.jsonl";
  const good1 = JSON.stringify(msg("m1"));
  const good2 = JSON.stringify(msg("m2"));
  // a truncated/corrupt middle line between two valid messages
  fs.write(path, good1 + "\n" + "{ truncated" + "\n" + good2 + "\n");
  const store = new JsonlStore(fs, path);
  const out = store.replay();
  assert.deepEqual(out.map((m) => m.id), ["m1", "m2"]);
});

test("replay on a fresh store with no file returns empty", () => {
  const store = new JsonlStore(new MemoryFs(), ".team/messages.jsonl");
  assert.deepEqual(store.replay(), []);
});
