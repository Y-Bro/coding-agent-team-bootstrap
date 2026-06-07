import { test } from "node:test";
import assert from "node:assert/strict";
import { get } from "node:http";
import { NodeHttpServer } from "../../src/ports/http.ts";
import { MemoryBus } from "../../src/broker/bus.ts";
import type { Message } from "../../src/a2a/index.ts";

function isSandboxNetError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EADDRNOTAVAIL";
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PORT = 47533;

test("NodeHttpServer.sse pushes a live event over a real socket when published", async (t) => {
  const bus = new MemoryBus();
  const server = new NodeHttpServer();
  server.sse("/events", (conn) => bus.subscribe((m) => conn.send(m, "message")));
  try {
    await server.listen(PORT);
  } catch (e) {
    if (isSandboxNetError(e)) { t.skip("loopback listen blocked under sandbox"); return; }
    throw e;
  }

  let body = "";
  const req = get({ host: "127.0.0.1", port: PORT, path: "/events" }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (c) => { body += c; });
  });
  try {
    // wait for the SSE connection to establish, then append a message
    for (let i = 0; i < 30 && body.length === 0; i++) await sleep(20);
    bus.publish({ id: "live-1", from: "a", to: "b", type: "note", parts: [], ts: "t" } as Message);
    for (let i = 0; i < 50 && !body.includes("live-1"); i++) await sleep(20);
    assert.match(body, /event: message/);
    assert.match(body, /"id":"live-1"/);
  } finally {
    req.destroy();
    await server.close();
  }
});
