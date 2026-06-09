import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO = process.cwd();
const TSX = import.meta.resolve("tsx");
const TEAM = join(REPO, "bin/team.ts");

const TEAM_YAML = `name: detached
root: .
runtime: panes
broker: { transport: unix, socket: .team/broker.sock }
engines:
  noop: { command: sleep, args: ["600"], roleFile: AGENTS.md }
agents:
  - { id: solo, role: writer, engine: noop }
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tmuxAvailable = () => spawnSync("tmux", ["-V"]).status === 0;

function connectable(sock: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = connect(sock)
      .on("connect", () => { c.end(); resolve(true); })
      .on("error", () => resolve(false));
  });
}

test("team up --detach frees the terminal but keeps the broker alive (team down stops it)", async (t) => {
  if (!tmuxAvailable()) { t.skip("tmux unavailable"); return; }
  const dir = mkdtempSync(join(tmpdir(), "team-detach-"));
  writeFileSync(join(dir, "team.yaml"), TEAM_YAML);
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const env = { ...process.env, TEAM_CONFIG: "team.yaml" };

  const sock = join(dir, ".team", "broker.sock");
  const pidfile = join(dir, ".team", "broker.pid");
  try {
    // The foreground process returns immediately (parent exits after spawning the child).
    const up = spawnSync(process.execPath, ["--import", TSX, TEAM, "up", "--detach"], {
      cwd: dir, env, encoding: "utf8", timeout: 15_000,
    });
    assert.equal(up.status, 0, `--detach should exit 0; stderr: ${up.stderr}`);
    assert.match(up.stdout, /detached/);

    // The detached child stays alive: pidfile + a connectable socket appear. The
    // pidfile is written only after the spawn loop (each agent has a launch-settle
    // delay), so allow generous time under full-suite tmux contention.
    for (let i = 0; i < 100 && !(existsSync(sock) && existsSync(pidfile)); i++) await sleep(100);
    assert.ok(existsSync(pidfile), "broker pidfile should exist");
    assert.ok(await connectable(sock), "broker socket should be connectable");

    // team down stops the detached broker and clears the pidfile.
    const down = spawnSync(process.execPath, ["--import", TSX, TEAM, "down"], {
      cwd: dir, env, encoding: "utf8", timeout: 15_000,
    });
    assert.equal(down.status, 0, `team down should succeed; stderr: ${down.stderr}`);
    for (let i = 0; i < 20 && existsSync(pidfile); i++) await sleep(100);
    assert.ok(!existsSync(pidfile), "pidfile should be cleared after team down");
  } finally {
    spawnSync("tmux", ["kill-session", "-t", "detached"]);
  }
});
