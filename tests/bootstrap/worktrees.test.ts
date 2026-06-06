import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorktrees } from "../../src/bootstrap/worktrees.ts";
import type { GitCommands } from "../../src/ports/git.ts";
import { loadConfig } from "../../src/config/index.ts";
import type { TeamConfig, AgentConfig } from "../../src/config/index.ts";

class SpyGit implements GitCommands {
  calls: string[][] = [];
  cwds: (string | undefined)[] = [];
  constructor(private listOutput = "") {}
  run(args: string[], cwd?: string): string {
    this.calls.push(args);
    this.cwds.push(cwd);
    return args[0] === "worktree" && args[1] === "list" ? this.listOutput : "";
  }
}

const adds = (git: SpyGit) => git.calls.filter((c) => c[0] === "worktree" && c[1] === "add");

test("creates a worktree+branch only for agents that declare one", () => {
  const git = new SpyGit();
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  createWorktrees(cfg, git);
  const wt = adds(git);
  assert.equal(wt.length, 1); // only fe-writer
  assert.ok(wt[0]!.join(" ").includes("feat/frontend"));
  assert.ok(wt[0]!.join(" ").includes("frontend"));
});

test("runs git in the project base cwd, not the process cwd (run-from-anywhere)", () => {
  const git = new SpyGit();
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  createWorktrees(cfg, git, "/proj");
  for (const cwd of git.cwds) assert.equal(cwd, "/proj");
});

test("reuses an existing worktree path instead of re-adding (idempotent)", () => {
  const git = new SpyGit("worktree /abs/repo/frontend\nHEAD abc\nbranch refs/heads/feat/frontend\n");
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  createWorktrees(cfg, git);
  assert.equal(adds(git).length, 0); // already present → no add
});

test("dedupes when multiple agents declare the same worktree path", () => {
  const wt = { branch: "feat/frontend", path: "frontend" };
  const agent = (id: string): AgentConfig => ({
    id, role: "writer", cli: "claude", engine: "claude", workdir: ".", worktree: wt,
    capabilities: [], skills: [], subscribes: [],
  });
  const cfg = { agents: [agent("a"), agent("b")] } as unknown as TeamConfig;
  const git = new SpyGit();
  createWorktrees(cfg, git);
  assert.equal(adds(git).length, 1); // same path declared twice → one add
});
