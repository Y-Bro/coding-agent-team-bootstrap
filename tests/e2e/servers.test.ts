import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/config/index.ts";
import { buildContainer } from "../../src/compose.ts";
import { NodeHttpServer } from "../../src/ports/http.ts";
import { A2AServer } from "../../src/a2a/http/server.ts";
import type { AgentCard, Message } from "../../src/a2a/index.ts";

/** A loopback listen blocked by the sandbox — skip rather than fail (like the v1 socket e2e). */
function isSandboxNetError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EADDRNOTAVAIL";
}

const cardOf = (a: { id: string; role: string; cli: string; engine: string; capabilities: string[]; skills: string[]; workdir: string; subscribes: string[] }): AgentCard => ({
  id: a.id, role: a.role, cli: a.cli as AgentCard["cli"], engine: a.engine,
  capabilities: a.capabilities, skills: a.skills, workdir: a.workdir, subscribes: a.subscribes,
});

test("end-to-end (servers): broker delivers over real loopback HTTP with bearer auth + scheduler", async (t) => {
  const cfg = loadConfig("tests/config/fixtures/todo-servers.yaml");
  const { broker } = buildContainer(cfg, {});

  // Each agent runs as a real A2AServer on its configured port, plus a /webhook
  // route (the servers-mode push target) that records what was delivered.
  type Received = { msg: Message; authorization?: string };
  const sinks = new Map<string, Received[]>();
  const servers: NodeHttpServer[] = [];

  for (let i = 0; i < cfg.agents.length; i++) {
    const agent = cfg.agents[i]!;
    const port = agent.port ?? cfg.servers.basePort + i;
    const sink: Received[] = [];
    sinks.set(agent.id, sink);

    const http = new NodeHttpServer();
    // Expose the agent as an A2AServer (card + message/send), as the spec requires.
    new A2AServer(http, cardOf(agent), { onMessageSend: ({ message }) => ({ message }) }).register();
    // The push-webhook target the A2ATransport delivers to.
    http.route("POST", "/webhook", async (req) => {
      sink.push({ msg: JSON.parse(req.body) as Message, authorization: req.headers?.["authorization"] });
      return { status: 200, body: "" };
    });

    try {
      await http.listen(port);
    } catch (e) {
      if (isSandboxNetError(e)) { t.skip("loopback HTTP listen blocked under sandbox"); return; }
      throw e;
    }
    servers.push(http);
  }

  try {
    for (const a of cfg.agents) broker.register(cardOf(a));

    // Route a direct message lead -> writer; it must traverse real HTTP to writer's webhook.
    await broker.send({ from: "lead", to: "writer", type: "ruling", parts: [{ kind: "text", text: "ship it" }] });

    const writerSink = sinks.get("writer")!;
    assert.equal(writerSink.length, 1, "writer received the delivery over loopback HTTP");
    assert.equal(writerSink[0]!.msg.type, "ruling");
    assert.equal((writerSink[0]!.msg.parts[0] as { text: string }).text, "ship it");
    assert.match(writerSink[0]!.authorization ?? "", /^Bearer \S+/, "broker-issued bearer attached on the wire");

    // Local inbox also carries it (broker-mediated routing, Q2).
    const inbox = broker.inbox("writer");
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]!.type, "ruling");

    // Routing correctness: a non-recipient agent got nothing.
    assert.equal(sinks.get("reviewer")!.length, 0);
  } finally {
    for (const s of servers) await s.close();
  }
});
