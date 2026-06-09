import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";
import { BrokerDaemon } from "../../src/broker/daemon.ts";
import { NodeSocketServer, BrokerAlreadyRunningError, probeLiveSocket, type SocketServer } from "../../src/ports/transport.ts";
import type { BrokerDispatch } from "../../src/broker/broker.ts";

function isSandboxNetError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EADDRNOTAVAIL";
}

const stubBroker: BrokerDispatch = {
  register() {}, agents() { return []; },
  async send() { return {} as never; }, async observe() {}, peek() { return []; }, ack() {},
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

test("listen creates the socket's parent dir on a fresh clone (no .team present)", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "team-fresh-"));
  const path = join(root, ".team", "broker.sock"); // .team does NOT exist yet
  assert.equal(existsSync(join(root, ".team")), false);
  const server = new NodeSocketServer();
  try {
    await server.listen(path, () => {}); // must not throw EACCES/ENOENT for the missing dir
  } catch (e) {
    // Only a genuine sandbox bind block is skippable; a missing-dir ENOENT/EACCES is the bug.
    if ((e as { code?: string } | null)?.code === "EPERM") { t.skip("loopback socket blocked under sandbox"); return; }
    throw e;
  }
  assert.equal(existsSync(path), true, "socket bound under the freshly-created .team/");
  await server.close();
});

test("the broker socket is created 0600 and its parent dir 0700 (L3)", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "team-perm-"));
  const subdir = join(root, ".team");      // created by listen()
  const path = join(subdir, "broker.sock");
  const server = new NodeSocketServer();
  try {
    await server.listen(path, () => {});
  } catch (e) {
    if (isSandboxNetError(e)) { t.skip("loopback socket blocked under sandbox"); return; }
    throw e;
  }
  try {
    assert.equal(statSync(path).mode & 0o777, 0o600, "socket restricted to owner rw");
    assert.equal(statSync(subdir).mode & 0o777, 0o700, "socket dir restricted to owner");
  } finally {
    await server.close();
  }
});

test("a malformed JSON frame does not crash the server; a later valid frame still works", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "team-sock-"));
  const path = join(dir, "broker.sock");
  const server = new NodeSocketServer();
  try {
    await server.listen(path, (msg, reply) => { reply({ ok: true, echo: msg }); });
  } catch (e) {
    if (isSandboxNetError(e)) { t.skip("loopback socket blocked under sandbox"); return; }
    throw e;
  }
  try {
    const replies = await new Promise<any[]>((resolve, reject) => {
      const sock = createConnection(path);
      let buf = ""; const out: any[] = [];
      sock.on("error", reject);
      sock.on("connect", () => {
        sock.write("{bad json\n");                                  // malformed frame first
        sock.write(JSON.stringify({ method: "ping" }) + "\n");      // valid frame after
      });
      sock.on("data", (chunk) => {
        buf += chunk.toString();
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          out.push(JSON.parse(buf.slice(0, idx)));
          buf = buf.slice(idx + 1);
          if (out.length === 2) { sock.end(); resolve(out); }
        }
      });
    });
    // the malformed frame got a structured error (not an uncaught crash) and the
    // later valid frame was still handled — proving the server survived the bad line
    assert.ok(replies.some((r) => r.ok === false), "malformed frame returned a structured error");
    assert.ok(replies.some((r) => r.ok === true && r.echo?.method === "ping"), "valid frame after the bad one was still handled");
  } finally {
    await server.close();
  }
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
