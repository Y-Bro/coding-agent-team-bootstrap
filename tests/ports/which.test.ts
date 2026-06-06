// tests/ports/which.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { NodeWhich } from "../../src/ports/which.ts";

test("NodeWhich.has returns true for node, false for a nonexistent binary", async () => {
  const which = new NodeWhich();
  assert.equal(await which.has("node"), true);
  assert.equal(await which.has("definitely-not-a-real-binary-xyz"), false);
});

test("NodeWhich.has rejects shell metacharacters without executing them", async () => {
  const which = new NodeWhich();
  // Must be treated as an invalid bare executable name, not shell-executed.
  assert.equal(await which.has("x; touch /tmp/pwned"), false);
  assert.equal(await which.has("no such bin"), false);
});
