import { test } from "node:test";
import assert from "node:assert/strict";
import { isMessage, isPart, type Message } from "../../src/a2a/index.ts";

test("isMessage validates a well-formed message", () => {
  const m: Message = {
    id: "m1", from: "fe-writer", to: "fe-reviewer",
    type: "review_request", parts: [{ kind: "text", text: "slice 4" }],
    ts: "2026-06-06T00:00:00.000Z",
  };
  assert.equal(isMessage(m), true);
});

test("isMessage rejects a message missing parts", () => {
  assert.equal(isMessage({ id: "x", from: "a", to: "b", type: "note" }), false);
});

test("isPart validates each variant's payload", () => {
  assert.equal(isPart({ kind: "text", text: "hi" }), true);
  assert.equal(isPart({ kind: "data", data: { any: "thing" } }), true);
  assert.equal(isPart({ kind: "data", data: null }), true);
  assert.equal(isPart({ kind: "file", path: "/tmp/x" }), true);
});

test("isPart rejects malformed variant payloads", () => {
  assert.equal(isPart({ kind: "text" }), false);
  assert.equal(isPart({ kind: "text", text: 123 }), false);
  assert.equal(isPart({ kind: "data" }), false);
  assert.equal(isPart({ kind: "file" }), false);
  assert.equal(isPart({ kind: "file", path: 123 }), false);
  assert.equal(isPart({ kind: "bogus" }), false);
});

test("isMessage rejects a message with a malformed part", () => {
  assert.equal(
    isMessage({
      id: "x", from: "a", to: "b", type: "note",
      parts: [{ kind: "file", path: 123 }], ts: "2026-06-06T00:00:00.000Z",
    }),
    false,
  );
});
