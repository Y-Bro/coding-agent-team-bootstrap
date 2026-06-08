import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_ENGINES } from "../../src/engines/registry.ts";

const by = (n: string) => BUILTIN_ENGINES.find((e) => e.name === n)!;

test("verified builtins expose headlessArgs", () => {
  assert.deepEqual(by("claude").headlessArgs, ["-p"]);
  assert.deepEqual(by("codex").headlessArgs, ["exec"]);
  assert.deepEqual(by("cursor-agent").headlessArgs, ["-p"]);
});

test("unverified builtins leave headlessArgs unset", () => {
  assert.equal(by("gemini").headlessArgs, undefined);
  assert.equal(by("opencode").headlessArgs, undefined);
  assert.equal(by("aider").headlessArgs, undefined);
});
