import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeHttpServer, NodeHttpClient } from "../../src/ports/http.ts";

function isSandboxNetError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EADDRNOTAVAIL";
}

/** Generate a self-signed localhost cert/key with openssl; null if unavailable. */
function selfSigned(): { cert: string; key: string } | null {
  const dir = mkdtempSync(join(tmpdir(), "team-tls-"));
  const r = spawnSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
    "-days", "1", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return { cert: readFileSync(join(dir, "cert.pem"), "utf8"), key: readFileSync(join(dir, "key.pem"), "utf8") };
}

const PORT = 47419;

test("TLS opt path: server + client negotiate over HTTPS with a configured CA", async (t) => {
  const pair = selfSigned();
  if (!pair) { t.skip("openssl unavailable"); return; }

  const server = new NodeHttpServer({ cert: pair.cert, key: pair.key });
  server.route("GET", "/.well-known/agent-card.json", () => ({ status: 200, body: JSON.stringify({ ok: true }) }));
  try {
    await server.listen(PORT);
  } catch (e) {
    if (isSandboxNetError(e)) { t.skip("loopback TLS listen blocked under sandbox"); return; }
    throw e;
  }

  try {
    // client trusts the self-signed cert as its CA
    const client = new NodeHttpClient({ ca: pair.cert });
    const res = await client.request(`https://localhost:${PORT}/.well-known/agent-card.json`, { method: "GET" });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true });

    // without the CA the same HTTPS call must fail to verify (TLS is actually on)
    const untrusting = new NodeHttpClient({ cert: undefined });
    await assert.rejects(() => untrusting.request(`https://localhost:${PORT}/.well-known/agent-card.json`, { method: "GET" }));
  } finally {
    await server.close();
  }
});

test("default path unchanged: plain HTTP server + client (no TLS) still works", async (t) => {
  const server = new NodeHttpServer(); // no tls
  server.route("GET", "/ping", () => ({ status: 200, body: "pong" }));
  try {
    await server.listen(PORT + 1);
  } catch (e) {
    if (isSandboxNetError(e)) { t.skip("loopback listen blocked under sandbox"); return; }
    throw e;
  }
  try {
    const res = await new NodeHttpClient().request(`http://127.0.0.1:${PORT + 1}/ping`, { method: "GET" });
    assert.equal(res.status, 200);
    assert.equal(res.body, "pong");
  } finally {
    await server.close();
  }
});
