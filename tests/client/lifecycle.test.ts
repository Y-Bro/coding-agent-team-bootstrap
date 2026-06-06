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
  kill(pid: number, signal: string): void { this.signals.push({ pid, signal }); }
  onShutdown(handler: () => void): void { this.handlers.push(handler); }
  fire(): void { for (const h of this.handlers) h(); }
}

test("teamUp starts the daemon, bootstraps, writes a pidfile, and stays alive", async () => {
  const daemon = new FakeDaemon();
  const boot = new FakeBootstrap();
  const fs = new MemoryFs();
  const proc = new FakeProc();
  await teamUp(daemon, boot, "/tmp/b.sock", { fs, proc, pidfile: ".team/broker.pid" });

  assert.equal(daemon.started, "/tmp/b.sock");
  assert.equal(boot.upped, "/tmp/b.sock");
  assert.equal(fs.read(".team/broker.pid"), "4242"); // pid recorded for `team down`
  assert.equal(daemon.stopped, false);               // NOT stopped — stays alive
});

test("the shutdown handler tears down cleanly and removes the pidfile", async () => {
  const daemon = new FakeDaemon();
  const boot = new FakeBootstrap();
  const fs = new MemoryFs();
  const proc = new FakeProc();
  await teamUp(daemon, boot, "/tmp/b.sock", { fs, proc, pidfile: ".team/broker.pid" });

  proc.fire(); // simulate SIGINT/SIGTERM
  await new Promise((r) => setImmediate(r));
  assert.equal(boot.downed, true);
  assert.equal(daemon.stopped, true);
  assert.equal(fs.exists(".team/broker.pid"), false);
});

test("teamDown signals the running daemon read from the pidfile and clears it", async () => {
  const fs = new MemoryFs();
  fs.write(".team/broker.pid", "4242");
  const proc = new FakeProc();
  const ok = await teamDown({ fs, proc, pidfile: ".team/broker.pid" });

  assert.equal(ok, true);
  assert.deepEqual(proc.signals, [{ pid: 4242, signal: "SIGTERM" }]);
  assert.equal(fs.exists(".team/broker.pid"), false);
});

test("teamDown is a no-op when no pidfile exists", async () => {
  const fs = new MemoryFs();
  const proc = new FakeProc();
  const ok = await teamDown({ fs, proc, pidfile: ".team/broker.pid" });
  assert.equal(ok, false);
  assert.deepEqual(proc.signals, []);
});
