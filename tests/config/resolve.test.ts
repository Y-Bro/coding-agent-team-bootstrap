import { test } from "node:test";
import assert from "node:assert/strict";
import { isAbsolute, join } from "node:path";
import { loadConfig } from "../../src/config/index.ts";
import { resolveConfigPaths, resolveBase } from "../../src/config/resolve.ts";

test("resolveBase: explicit root wins, else config dir, else cwd", () => {
  // relative root is interpreted against the config file's directory (the TEAM_CONFIG tier)
  assert.equal(resolveBase({ root: "." } as any, "/proj/team.yaml"), "/proj");
  // absolute root wins outright
  assert.equal(resolveBase({ root: "/elsewhere" } as any, "/proj/team.yaml"), "/elsewhere");
  // a bare config path (no dir) falls back to cwd
  assert.equal(resolveBase({ root: "." } as any, "team.yaml"), process.cwd());
});

test("resolveConfigPaths makes broker.socket + agent workdir/worktree absolute against base", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  const resolved = resolveConfigPaths(cfg, "/proj");

  assert.equal(resolved.broker.socket, "/proj/.team/broker.sock");
  const lead = resolved.agents.find((a) => a.id === "lead")!;
  assert.equal(lead.workdir, "/proj");
  const feWriter = resolved.agents.find((a) => a.id === "fe-writer")!;
  assert.equal(feWriter.worktree!.path, "/proj/frontend");
  const feReviewer = resolved.agents.find((a) => a.id === "fe-reviewer")!;
  assert.equal(feReviewer.workdir, "/proj/frontend");
  for (const a of resolved.agents) assert.ok(isAbsolute(a.workdir));
});

test("resolveConfigPaths leaves an already-absolute root/workdir intact", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  const resolved = resolveConfigPaths({ ...cfg, agents: cfg.agents.map((a) => ({ ...a, workdir: "/abs/here" })) }, "/proj");
  for (const a of resolved.agents) assert.equal(a.workdir, "/abs/here");
});

test("resolveConfigPaths preserves non-path fields", () => {
  const cfg = loadConfig("tests/config/fixtures/todo.yaml");
  const resolved = resolveConfigPaths(cfg, "/proj");
  assert.equal(resolved.name, cfg.name);
  assert.deepEqual(resolved.agents.map((a) => a.id), cfg.agents.map((a) => a.id));
  assert.equal(resolved.agents[0]!.role, cfg.agents[0]!.role);
});
