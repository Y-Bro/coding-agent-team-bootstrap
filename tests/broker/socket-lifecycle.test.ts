import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BrokerDaemon } from "../../src/broker/daemon.ts";
import { NodeSocketServer, BrokerAlreadyRunningError, probeLiveSocket, type SocketServer } from "../../src/ports/transport.ts";
import type { BrokerDispatch } from "../../src/broker/broker.ts";

function isSandboxNetError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EADDRNOTAVAIL";
}

const stubBroker: BrokerDispatch = {
  register() {}, agents() { return []; },
  async send() { return {} as never; }, inbox() { return []; },
};

class ThrowingServer implements SocketServer {
  constructor(private err: unknown) {}
  async listen(): Promise<void> { throw this.err; }
  async close(): Promise<void> {}
}

test("daemon normalizes a raw EADDRINUSE into a clear 'already running' error", async () => {
  const daemon = new BrokerDaemon(stubBroker, new ThrowingServer(Object.assign(new Error("bind"), { code: "EADDRINUSE" })));
  await assert.rejects(() => daemon.start("/tmp/x.sock"), (e: unknown) => {
    assert.ok(e instanceof BrokerAlreadyRunningError);
    assert.match((e as Error).message, /already running.*team down/);
    return true;
  });
});

test("daemon propagates a BrokerAlreadyRunningError from the server", async () => {
  const daemon = new BrokerDaemon(stubBroker, new ThrowingServer(new BrokerAlreadyRunningError()));
  await assert.rejects(() => daemon.start("/tmp/x.sock"), BrokerAlreadyRunningError);
});

test("probeLiveSocket returns false for a path with no listener", async () => {
  assert.equal(await probeLiveSocket(join(tmpdir(), "definitely-not-a-socket.sock")), false);
});

test("a stale socket file (no live owner) is unlinked and listen succeeds", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "team-sock-"));
  const path = join(dir, "broker.sock");
  writeFileSync(path, ""); // leftover from a crash — not a live socket
  const server = new NodeSocketServer();
  try {
    await server.listen(path, () => {});
  } catch (e) {
    if (isSandboxNetError(e)) { t.skip("loopback socket blocked under sandbox"); return; }
    throw e;
  }
  assert.equal(existsSync(path), true, "a fresh socket is now bound");
  await server.close();
});

test("starting two daemons on the same socket is graceful, not an unhandled crash", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "team-sock-"));
  const path = join(dir, "broker.sock");
  const first = new NodeSocketServer();
  try {
    await first.listen(path, () => {});
  } catch (e) {
    if (isSandboxNetError(e)) { t.skip("loopback socket blocked under sandbox"); return; }
    throw e;
  }
  try {
    const second = new NodeSocketServer();
    await assert.rejects(() => second.listen(path, () => {}), BrokerAlreadyRunningError);
  } finally {
    await first.close();
  }
});
