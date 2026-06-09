import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { NodeHttpServer } from "../../src/ports/http.ts";

function isSandboxNetError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EADDRNOTAVAIL";
}

/** Minimal one-shot HTTP request against 127.0.0.1 for these real-socket tests. */
function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("listen rejects when the port is already in use (bind error)", async (t) => {
  const PORT = 47611;
  const first = new NodeHttpServer();
  try {
    await first.listen(PORT);
  } catch (e) {
    if (isSandboxNetError(e)) { t.skip("loopback listen blocked under sandbox"); return; }
    throw e;
  }
  try {
    const second = new NodeHttpServer();
    await assert.rejects(() => second.listen(PORT)); // EADDRINUSE must reject, not crash
  } finally {
    await first.close();
  }
});

test("a throwing route handler yields HTTP 500 with a JSON error body", async (t) => {
  const PORT = 47612;
  const server = new NodeHttpServer();
  server.route("GET", "/boom", () => { throw new Error("kaboom"); });
  try {
    await server.listen(PORT);
  } catch (e) {
    if (isSandboxNetError(e)) { t.skip("loopback listen blocked under sandbox"); return; }
    throw e;
  }
  try {
    const res = await httpGet(PORT, "/boom");
    assert.equal(res.status, 500);
    assert.match(res.body, /error/);
  } finally {
    await server.close();
  }
});
