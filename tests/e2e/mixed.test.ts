import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { TeamConfigSchema, type TeamConfig } from "../../src/config/schema.ts";
import { resolveConfigPaths } from "../../src/config/index.ts";
import { buildContainer } from "../../src/compose.ts";
import { NodeHttpServer } from "../../src/ports/http.ts";
import { A2AServer } from "../../src/a2a/http/server.ts";
import { toCard } from "../../src/bootstrap/roles.ts";
import type { Message } from "../../src/a2a/index.ts";

function isSandboxNetError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EADDRNOTAVAIL";
}
const tmuxAvailable = () => spawnSync("tmux", ["-V"]).status === 0;

const PORT = 47311;

function mixedCfg(base: string): TeamConfig {
  // team default panes; "sr" overridden to a server runtime on a loopback port.
  return resolveConfigPaths(TeamConfigSchema.parse({
    name: "mixed-e2e",
    runtime: "panes",
    broker: { transport: "unix", socket: ".team/broker.sock" },
    servers: { host: "127.0.0.1", basePort: PORT, auth: false },
    engines: {
      pane: { command: "sleep", args: ["600"], roleFile: "AGENTS.md" },
      srv: { command: "sleep", args: ["600"], roleFile: "AGENTS.md", kind: "server" },
    },
    agents: [
      { id: "pw", role: "writer", engine: "pane", subscribes: ["note"] },
      { id: "sr", role: "reviewer", runtime: "servers", engine: "srv", port: PORT, subscribes: ["review_request"] },
    ],
  }), base);
}

test("mixed team: messages cross the pane<->server boundary in both directions", async (t) => {
  if (!tmuxAvailable()) { t.skip("tmux unavailable"); return; }
  const base = mkdtempSync(join(tmpdir(), "team-mixed-"));
  const cfg = mixedCfg(base);
  const { broker, runtime } = buildContainer(cfg, {});
  const pw = cfg.agents.find((a) => a.id === "pw")!;
  const sr = cfg.agents.find((a) => a.id === "sr")!;

  // The server agent runs a REAL A2AServer + /webhook (the servers-mode push target).
  const received: Message[] = [];
  const http = new NodeHttpServer();
  new A2AServer(http, toCard(sr), { onMessageSend: ({ message }) => ({ message }) }).register();
  http.route("POST", "/webhook", async (req) => { received.push(JSON.parse(req.body) as Message); return { status: 200, body: "" }; });
  try {
    await http.listen(PORT);
  } catch (e) {
    if (isSandboxNetError(e)) { t.skip("loopback HTTP listen blocked under sandbox"); return; }
    throw e;
  }

  try {
    broker.register(toCard(pw));
    broker.register(toCard(sr));
    // The pane agent runs in a REAL tmux pane (so server->pane wake has a target).
    await runtime.spawn(toCard(pw), { config: cfg, socketPath: cfg.broker.socket });

    // pane -> server: must traverse real loopback HTTP to the server's webhook.
    await broker.send({ from: "pw", to: "sr", type: "review_request", parts: [{ kind: "text", text: "PR #7" }] });
    assert.equal(received.length, 1, "server agent received pane->server over real HTTP");
    assert.equal(received[0]!.from, "pw");
    assert.equal(broker.inbox("sr").length, 1);

    // server -> pane: bridged to the socket transport; the pane is woken (no throw)
    // and the message lands in the pane agent's broker inbox to pull.
    await broker.send({ from: "sr", to: "pw", type: "note", parts: [{ kind: "text", text: "thanks" }] });
    assert.equal(received.length, 1, "server->pane must NOT go over the server's HTTP webhook");
    const inbox = broker.inbox("pw");
    assert.equal(inbox.length, 1);
    assert.equal((inbox[0]!.parts[0] as { text: string }).text, "thanks");
  } finally {
    await runtime.teardown();
    await http.close();
    spawnSync("tmux", ["kill-session", "-t", "mixed-e2e"]);
  }
});
