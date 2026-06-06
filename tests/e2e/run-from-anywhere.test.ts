import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const TSX = import.meta.resolve("tsx");
const TEAM = join(REPO, "bin/team.ts");

// root: . → base resolves to the config file's directory, not the cwd.
const TEAM_YAML = `name: anywhere
root: .
runtime: panes
broker: { transport: unix, socket: .team/broker.sock }
engines:
  noop: { command: sleep, args: ["600"], roleFile: AGENTS.md }
agents:
  - { id: solo, role: writer, engine: noop }
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("team up from a foreign cwd puts .team next to the config, not the cwd (run-from-anywhere)", async (t) => {
  const project = mkdtempSync(join(tmpdir(), "team-proj-"));
  const elsewhere = mkdtempSync(join(tmpdir(), "team-cwd-"));
  writeFileSync(join(project, "team.yaml"), TEAM_YAML);
  spawnSync("git", ["init", "-q"], { cwd: project });

  // Run from `elsewhere`, pointing TEAM_CONFIG at the project's absolute config.
  const up = spawn(process.execPath, ["--import", TSX, TEAM, "up"], {
    cwd: elsewhere, env: { ...process.env, TEAM_CONFIG: join(project, "team.yaml") },
  });
  let upErr = "";
  up.stderr.on("data", (c) => { upErr += c.toString(); });
  let exited: number | null = null;
  up.on("exit", (code) => { exited = code ?? 0; });

  const projectSock = join(project, ".team", "broker.sock");
  const cwdSock = join(elsewhere, ".team", "broker.sock");
  try {
    for (let i = 0; i < 30 && !existsSync(projectSock) && exited === null; i++) await sleep(100);
    if (exited !== null && /tmux|ENOENT|spawn/.test(upErr)) {
      t.skip(`tmux unavailable: ${upErr.trim()}`);
      return;
    }
    assert.ok(existsSync(projectSock), `socket should live in the project; up stderr: ${upErr}`);
    assert.ok(!existsSync(cwdSock), "socket must NOT be created in the foreign cwd");
    // the agent's role file is written into the project (during bootstrap, just
    // after the socket comes up), not the cwd
    const roleFile = join(project, "AGENTS.md");
    for (let i = 0; i < 20 && !existsSync(roleFile); i++) await sleep(50);
    assert.ok(existsSync(roleFile), "role file should land in the project base");
    assert.ok(!existsSync(join(elsewhere, "AGENTS.md")), "role file must NOT land in the cwd");
  } finally {
    up.kill("SIGKILL");
    spawnSync("tmux", ["kill-session", "-t", "anywhere"]);
  }
});
