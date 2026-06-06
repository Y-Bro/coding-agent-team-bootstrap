import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const TSX = import.meta.resolve("tsx");
const TEAM = join(REPO, "bin/team.ts");

const TEAM_YAML = `name: smoke2
root: .
runtime: panes
broker: { transport: unix, socket: .team/broker.sock }
engines:
  noop: { command: sleep, args: ["600"], roleFile: AGENTS.md }
agents:
  - { id: alpha, role: writer, engine: noop }
  - { id: beta, role: reviewer, engine: noop, subscribes: [] }
`;

function runVerb(dir: string, args: string[], agentId?: string) {
  return spawnSync(process.execPath, ["--import", TSX, TEAM, ...args], {
    cwd: dir, encoding: "utf8",
    env: { ...process.env, ...(agentId ? { TEAM_AGENT_ID: agentId } : {}) },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("panes team up registers the roster: team ps lists agents and send/inbox route (fix-panes-register)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "team-roster-"));
  writeFileSync(join(dir, "team.yaml"), TEAM_YAML);
  spawnSync("git", ["init", "-q"], { cwd: dir });

  const up = spawn(process.execPath, ["--import", TSX, TEAM, "up"], {
    cwd: dir, env: { ...process.env, TEAM_CONFIG: "team.yaml" },
  });
  let upErr = "";
  up.stderr.on("data", (c) => { upErr += c.toString(); });
  let exited: number | null = null;
  up.on("exit", (code) => { exited = code ?? 0; });

  const sock = join(dir, ".team", "broker.sock");
  try {
    // Wait for the broker socket to come up (or the child to bail on missing tmux).
    for (let i = 0; i < 30 && !existsSync(sock) && exited === null; i++) await sleep(100);
    if (exited !== null && /tmux|ENOENT|spawn/.test(upErr)) {
      t.skip(`tmux unavailable: ${upErr.trim()}`);
      return;
    }
    assert.ok(existsSync(sock), `broker socket should exist; up stderr: ${upErr}`);

    // team ps lists both agents from the registered roster.
    const ps = runVerb(dir, ["ps"]);
    assert.match(ps.stdout, /alpha/);
    assert.match(ps.stdout, /beta/);

    // alpha sends a note to beta; beta's inbox receives it (routing works).
    const sent = runVerb(dir, ["send", "--to", "beta", "--type", "note", "hello beta"], "alpha");
    assert.equal(sent.status, 0, `send failed: ${sent.stderr}`);
    assert.doesNotMatch(sent.stderr, /unknown target/i);

    const inbox = runVerb(dir, ["inbox"], "beta");
    assert.match(inbox.stdout, /hello beta/);
  } finally {
    up.kill("SIGKILL");
    spawnSync("tmux", ["kill-session", "-t", "smoke2"]);
  }
});
