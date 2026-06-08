import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
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
// Production base is always absolute (resolveBase()); use one so target keys are
// deterministic and absolute-path handling is exercised the same way it runs.
const base = "/proj";
const at = (dir: string, file: string) => resolve(base, dir, file);
const agents = [
  { id: "lead", role: "lead", engine: "claude", subscribes: ["escalation"] },
  { id: "reviewer", role: "reviewer", engine: "codex", subscribes: ["review_request"] },
];

test("writes one file per agent named by engine roleFile, guidance + footer", async () => {
  const { fs, files } = memFs();
  const warns: string[] = [];
  await new ContextScaffolder(fs, okGen("GUIDE"), reg, (m) => warns.push(m))
    .scaffold("t", agents, base);
  const claude = files.get(at(".", "CLAUDE.md"))!;
  const codex = files.get(at(".", "AGENTS.md"))!;
  assert.equal(claude, "GUIDE\n\n" + claude.split("\n\n").slice(1).join("\n\n"));
  assert.ok(claude.startsWith("GUIDE\n\n## How to communicate"));
  assert.ok(codex.startsWith("GUIDE\n\n## How to communicate"));
});

test("null guidance writes wiring-only and warns", async () => {
  const { fs, files } = memFs();
  const warns: string[] = [];
  await new ContextScaffolder(fs, nullGen, reg, (m) => warns.push(m))
    .scaffold("t", [agents[0]!], base);
  assert.ok(files.get(at(".", "CLAUDE.md"))!.startsWith("## How to communicate"));
  assert.equal(warns.length, 1);
});

test("never overwrites an existing file (skip + warn)", async () => {
  const { fs, files } = memFs();
  files.set(at(".", "CLAUDE.md"), "PRE-EXISTING");
  const warns: string[] = [];
  await new ContextScaffolder(fs, okGen("GUIDE"), reg, (m) => warns.push(m))
    .scaffold("t", [agents[0]!], base);
  assert.equal(files.get(at(".", "CLAUDE.md")), "PRE-EXISTING");
  assert.equal(warns.length, 1);
});

test("resolves a worktree agent's file under its worktree path", async () => {
  const { fs, files } = memFs();
  const a = [{ id: "w", role: "writer", engine: "claude", worktree: { branch: "b", path: "worktrees/w" } }];
  await new ContextScaffolder(fs, okGen("G"), reg, () => {}).scaffold("t", a, base);
  assert.ok(files.has(at("worktrees/w", "CLAUDE.md")));
});

test("names the file from a config-defined engine's custom roleFile", async () => {
  const { fs, files } = memFs();
  const customReg = resolveEngines({
    engines: { mine: { command: "mycli", roleFile: "CUSTOM.md" } },
  });
  const a = [{ id: "c", role: "writer", engine: "mine", subscribes: [] }];
  await new ContextScaffolder(fs, okGen("G"), customReg, () => {}).scaffold("t", a, base);
  assert.ok(files.has(at(".", "CUSTOM.md")));
  assert.ok(files.get(at(".", "CUSTOM.md"))!.startsWith("G\n\n## How to communicate"));
});

test("does not prefix base onto an already-absolute workdir or worktree path", async () => {
  const { fs, files } = memFs();
  const absAgents = [
    { id: "x", role: "writer", engine: "claude", workdir: "/abs/work" },
    { id: "y", role: "writer", engine: "claude", worktree: { branch: "b", path: "/abs/tree" } },
  ];
  await new ContextScaffolder(fs, okGen("G"), reg, () => {}).scaffold("t", absAgents, base);
  assert.ok(files.has("/abs/work/CLAUDE.md"));
  assert.ok(files.has("/abs/tree/CLAUDE.md"));
  assert.ok(![...files.keys()].some((k) => k.startsWith("/proj/abs")));
});
