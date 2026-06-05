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

test("replay on a fresh store with no file returns empty", () => {
  const store = new JsonlStore(new MemoryFs(), ".team/messages.jsonl");
  assert.deepEqual(store.replay(), []);
});
