import { test } from "node:test";
import assert from "node:assert/strict";
import { teamUp, teamDown } from "../../src/client/lifecycle.ts";
import type { DaemonLike, BootstrapLike, ProcessControl } from "../../src/client/lifecycle.ts";
import { MemoryFs } from "../ports/fakes.ts";

class FakeDaemon implements DaemonLike {
  started?: string;
  stopped = false;
  async start(socket: string): Promise<void> { this.started = socket; }
  async stop(): Promise<void> { this.stopped = true; }
}
class FakeBootstrap implements BootstrapLike {
  upped?: string;
  downed = false;
  async up(socket: string): Promise<void> { this.upped = socket; }
  async down(): Promise<void> { this.downed = true; }
}
class FakeProc implements ProcessControl {
  pid = 4242;
  signals: Array<{ pid: number; signal: string }> = [];
  private handlers: Array<() => void> = [];
  private exitHandlers: Array<() => void> = [];
  kill(pid: number, signal: string): void { this.signals.push({ pid, signal }); }
  onShutdown(handler: () => void): void { this.handlers.push(handler); }
  onExit(handler: () => void): void { this.exitHandlers.push(handler); }
  fire(): void { for (const h of this.handlers) h(); }
  fireExit(): void { for (const h of this.exitHandlers) h(); }
}

const SOCK = "/tmp/b.sock";
const PID = ".team/broker.pid";
const deps = (fs: MemoryFs, proc: FakeProc) => ({ fs, proc, pidfile: PID, socket: SOCK });

test("teamUp starts the daemon, bootstraps, writes a pidfile, and stays alive", async () => {
  const daemon = new FakeDaemon();
  const boot = new FakeBootstrap();
  const fs = new MemoryFs();
  const proc = new FakeProc();
  await teamUp(daemon, boot, SOCK, deps(fs, proc));

  assert.equal(daemon.started, SOCK);
  assert.equal(boot.upped, SOCK);
  assert.equal(fs.read(PID), "4242"); // pid recorded for `team down`
  assert.equal(daemon.stopped, false); // NOT stopped — stays alive
});

test("the shutdown handler tears down cleanly and removes the pidfile + socket", async () => {
  const daemon = new FakeDaemon();
  const boot = new FakeBootstrap();
  const fs = new MemoryFs();
  fs.write(SOCK, ""); // the bound socket file
  const proc = new FakeProc();
  await teamUp(daemon, boot, SOCK, deps(fs, proc));

  proc.fire(); // simulate SIGINT/SIGTERM
  await new Promise((r) => setImmediate(r));
  assert.equal(boot.downed, true);
  assert.equal(daemon.stopped, true);
  assert.equal(fs.exists(PID), false);
  assert.equal(fs.exists(SOCK), false, "socket removed so the next run binds cleanly");
});

test("the exit handler best-effort clears pidfile + socket (crash doesn't poison next run)", async () => {
  const fs = new MemoryFs();
  fs.write(PID, "4242");
  fs.write(SOCK, "");
  const proc = new FakeProc();
  await teamUp(new FakeDaemon(), new FakeBootstrap(), SOCK, deps(fs, proc));

  proc.fireExit(); // simulate process 'exit'
  assert.equal(fs.exists(PID), false);
  assert.equal(fs.exists(SOCK), false);
});

test("teamDown signals the running daemon, clears the pidfile and socket", async () => {
  const fs = new MemoryFs();
  fs.write(PID, "4242");
  fs.write(SOCK, "");
  const proc = new FakeProc();
  const ok = await teamDown(deps(fs, proc));

  assert.equal(ok, true);
  assert.deepEqual(proc.signals, [{ pid: 4242, signal: "SIGTERM" }]);
  assert.equal(fs.exists(PID), false);
  assert.equal(fs.exists(SOCK), false);
});

test("teamDown is a no-op when no pidfile exists", async () => {
  const fs = new MemoryFs();
  const proc = new FakeProc();
  const ok = await teamDown(deps(fs, proc));
  assert.equal(ok, false);
  assert.deepEqual(proc.signals, []);
});
