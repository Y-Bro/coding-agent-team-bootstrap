import { test } from "node:test";
import assert from "node:assert/strict";
import { encode, decodeLines } from "../../src/broker/protocol.ts";

test("encode/decode round-trips newline-delimited JSON", () => {
  const a = encode({ method: "agent/list", params: {} });
  const b = encode({ ok: true, result: [] });
  const decoded = [...decodeLines(a + b)];
  assert.equal(decoded.length, 2);
  assert.deepEqual((decoded[0] as any).method, "agent/list");
});
