import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorktrees } from "../../src/bootstrap/worktrees.ts";
import type { GitCommands } from "../../src/ports/git.ts";
import { loadConfig } from "../../src/config/index.ts";

class SpyGit implements GitCommands {
  calls: string[][] = [];
  run(args: string[]): string { this.calls.push(args); return ""; }
}

test("creates a worktree+branch only for agents that declare one", () => {
  const git = new SpyGit();
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  createWorktrees(cfg, git);
  const wt = git.calls.filter((c) => c[0] === "worktree");
  assert.equal(wt.length, 1); // only fe-writer
  assert.ok(wt[0]!.join(" ").includes("feat/frontend"));
  assert.ok(wt[0]!.join(" ").includes("frontend"));
});
