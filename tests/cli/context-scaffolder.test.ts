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
const okGen = (text: string): GuidanceGenerator => ({ async generate() { return text; } });
const nullGen: GuidanceGenerator = { async generate() { return null; } };
const reg = resolveEngines({});
const agents = [
  { id: "lead", role: "lead", engine: "claude", subscribes: ["escalation"] },
  { id: "reviewer", role: "reviewer", engine: "codex", subscribes: ["review_request"] },
];

test("writes one file per agent named by engine roleFile, guidance + footer", async () => {
  const { fs, files } = memFs();
  const warns: string[] = [];
  await new ContextScaffolder(fs, okGen("GUIDE"), reg, (m) => warns.push(m))
    .scaffold("t", agents, ".");
  assert.equal(files.get("CLAUDE.md"), "GUIDE\n\n" + files.get("CLAUDE.md")!.split("\n\n").slice(1).join("\n\n"));
  assert.ok(files.get("CLAUDE.md")!.startsWith("GUIDE\n\n## Team wiring"));
  assert.ok(files.get("AGENTS.md")!.startsWith("GUIDE\n\n## Team wiring"));
});

test("null guidance writes wiring-only and warns", async () => {
  const { fs, files } = memFs();
  const warns: string[] = [];
  await new ContextScaffolder(fs, nullGen, reg, (m) => warns.push(m))
    .scaffold("t", [agents[0]!], ".");
  assert.ok(files.get("CLAUDE.md")!.startsWith("## Team wiring"));
  assert.equal(warns.length, 1);
});

test("never overwrites an existing file (skip + warn)", async () => {
  const { fs, files } = memFs();
  files.set("CLAUDE.md", "PRE-EXISTING");
  const warns: string[] = [];
  await new ContextScaffolder(fs, okGen("GUIDE"), reg, (m) => warns.push(m))
    .scaffold("t", [agents[0]!], ".");
  assert.equal(files.get("CLAUDE.md"), "PRE-EXISTING");
  assert.equal(warns.length, 1);
});

test("resolves a worktree agent's file under its worktree path", async () => {
  const { fs, files } = memFs();
  const a = [{ id: "w", role: "writer", engine: "claude", worktree: { branch: "b", path: "worktrees/w" } }];
  await new ContextScaffolder(fs, okGen("G"), reg, () => {}).scaffold("t", a, ".");
  assert.ok(files.has("worktrees/w/CLAUDE.md"));
});
