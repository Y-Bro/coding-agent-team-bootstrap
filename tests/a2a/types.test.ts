import { test } from "node:test";
import assert from "node:assert/strict";
import { isMessage, type Message } from "../../src/a2a/index.ts";

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
