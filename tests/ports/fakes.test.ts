import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryFs, SeqIds } from "./fakes.ts";

test("MemoryFs append accumulates", () => {
  const fs = new MemoryFs();
  fs.append("a", "x\n"); fs.append("a", "y\n");
  assert.equal(fs.read("a"), "x\ny\n");
});

test("SeqIds increments", () => {
  const ids = new SeqIds();
  assert.equal(ids.next(), "m1");
  assert.equal(ids.next("t"), "t2");
});
