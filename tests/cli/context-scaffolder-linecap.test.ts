import { test } from "node:test";
import assert from "node:assert/strict";
import { ContextScaffolder } from "../../src/cli/context-scaffolder.ts";
import { resolveEngines } from "../../src/engines/registry.ts";
import type { GuidanceGenerator } from "../../src/ports/guidance.ts";
import type { FileSystem } from "../../src/ports/fs.ts";

function memFs() {
  const files = new Map<string, string>();
  const fs: FileSystem = {
    append: (p, d) => files.set(p, (files.get(p) ?? "") + d),
    read: (p) => files.get(p) ?? "",
    write: (p, d) => { files.set(p, d); },
    exists: (p) => files.has(p),
    remove: (p) => { files.delete(p); },
  };
  return { fs, files };
}
const hugeGen: GuidanceGenerator = { async generate() { return Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n"); } };
const reg = resolveEngines({});

test("written markdown never exceeds 200 lines", async () => {
  const { fs, files } = memFs();
  await new ContextScaffolder(fs, hugeGen, reg, () => {})
    .scaffold("t", [{ id: "a", role: "writer", engine: "claude", subscribes: [] }], ".");
  // exactly one file written; grab it regardless of the resolved path
  const content = [...files.values()][0]!;
  const lineCount = content.split("\n").length;
  assert.ok(lineCount <= 200, `expected <=200 lines, got ${lineCount}`);
  // footer must survive the cap
  assert.match(content, /## How to communicate/);
});
