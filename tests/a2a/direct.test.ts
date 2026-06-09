import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectMessenger } from "../../src/a2a/direct.ts";
import { A2AServer } from "../../src/a2a/http/server.ts";
import { A2AClient } from "../../src/a2a/http/client.ts";
import type { A2AEndpoints } from "../../src/broker/a2a-transport.ts";
import { Broker } from "../../src/broker/broker.ts";
import { JsonlStore } from "../../src/broker/store.ts";
import { AgentRegistry } from "../../src/broker/registry.ts";
import { Router } from "../../src/broker/router.ts";
import { FeedRenderer } from "../../src/broker/feed.ts";
import type { Transport } from "../../src/broker/transport.ts";
import type { HttpServer, HttpClient, HttpHandler, HttpResponse } from "../../src/ports/http.ts";
import { MemoryFs, FixedClock, SeqIds } from "../ports/fakes.ts";
import type { AgentCard, Message } from "../../src/a2a/index.ts";

/** An in-memory HTTP fabric: A2AServers register routes by baseUrl; the client routes by URL prefix. */
class HttpFabric {
  private routes = new Map<string, HttpHandler>(); // "BASEURL METHOD PATH" → handler
  serverFor(baseUrl: string): HttpServer {
    const routes = this.routes;
    return {
      route(method, path, handler) { routes.set(`${baseUrl} ${method.toUpperCase()} ${path}`, handler); },
      async listen() {}, async close() {},
    };
  }
  client(): HttpClient {
    const routes = this.routes;
    return {
      async request(url, init): Promise<HttpResponse> {
        for (const [key, handler] of routes) {
          const [base, method, path] = key.split(" ");
          if (url === base! + path! && init.method.toUpperCase() === method!) {
            return handler({ method: init.method, path: path!, body: init.body ?? "", headers: init.headers });
          }
        }
        return { status: 404, body: "" };
      },
    };
  }
}

/** Records messages this agent's A2A server receives. */
class RecordingHandler {
  received: Message[] = [];
  onMessageSend(params: { message: Message }) { this.received.push(params.message); return { message: params.message }; }
}

class SpyTransport implements Transport {
  delivered: string[] = [];
  async deliver(recipient: AgentCard, m: Message): Promise<void> { this.delivered.push(`${recipient.id}:${m.id}`); }
  async listen(): Promise<void> {}
  async close(): Promise<void> {}
}

const card = (over: Partial<AgentCard>): AgentCard => ({
  id: "x", role: "writer", cli: "claude", engine: "claude", capabilities: [], skills: [],
  workdir: ".", subscribes: [], ...over,
});

function setup() {
  const fabric = new HttpFabric();
  const httpClient = fabric.client();
  const urls = new Map<string, string>(); // agentId → baseUrl

  const a = card({ id: "a", role: "writer" });
  const b = card({ id: "b", role: "reviewer", subscribes: ["review_request"] });
  urls.set("a", "http://a.local"); urls.set("b", "http://b.local");

  // Each agent runs its own A2A server on the fabric.
  const handlers = new Map<string, RecordingHandler>();
  for (const c of [a, b]) {
    const h = new RecordingHandler();
    handlers.set(c.id, h);
    new A2AServer(fabric.serverFor(urls.get(c.id)!), c, h).register();
  }

  // The sender's view: local directory of published cards + a router over it.
  const directory = new AgentRegistry();
  directory.register(a); directory.register(b);
  const endpoints: A2AEndpoints = { clientFor: (c) => new A2AClient(httpClient, urls.get(c.id)!) };

  // The broker as observer only (its transport must never be touched in direct mode).
  const fs = new MemoryFs();
  const transport = new SpyTransport();
  const registry = new AgentRegistry();
  const broker = new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry, router: new Router(registry),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    transport, clock: new FixedClock(), ids: new SeqIds(),
  });
  broker.register(a); broker.register(b);

  const messenger = new DirectMessenger({
    directory, router: new Router(directory), endpoints,
    observer: broker, clock: new FixedClock(), ids: new SeqIds(),
  });
  return { messenger, handlers, broker, transport, fs };
}

test("direct round-trip: message/send reaches the recipient's A2A server with no broker mediating", async () => {
  const { messenger, handlers } = setup();
  await messenger.send({ from: "a", to: "b", type: "review_request", parts: [{ kind: "text", text: "PR #1" }] });

  // b's own server received the message directly; a (the sender) did not
  assert.equal(handlers.get("b")!.received.length, 1);
  assert.equal(handlers.get("b")!.received[0]!.from, "a");
  assert.equal(handlers.get("a")!.received.length, 0);
});

test("the broker observes + logs the direct message without being in the delivery path", async () => {
  const { messenger, broker, transport, fs } = setup();
  const sent = await messenger.send({ from: "a", to: "b", type: "review_request", parts: [{ kind: "text", text: "PR #1" }] });

  // broker transport was never used for delivery
  assert.deepEqual(transport.delivered, []);
  // durable log + feed recorded it, and the live inbox reflects it
  assert.match(fs.read(".team/messages.jsonl"), new RegExp(sent.id));
  assert.match(fs.read(".team/feed.md"), /PR #1/);
  assert.equal(broker.peek("b").length, 1);
});

test("direct send observes once up-front and tolerates a per-recipient delivery failure", async () => {
  const a = card({ id: "a", role: "pair" });
  const b = card({ id: "b", role: "pair" });
  const directory = new AgentRegistry();
  directory.register(a); directory.register(b);

  const attempted: string[] = [];
  const endpoints: A2AEndpoints = {
    clientFor: (c) => ({
      async sendMessage(m: Message) {
        attempted.push(c.id);
        if (c.id === "b") throw new Error("b unreachable");
        return { message: m };
      },
    }) as any,
  };
  const observed: Message[] = [];
  const observer = { observe: async (m: Message) => { observed.push(m); } };

  const messenger = new DirectMessenger({
    directory, router: new Router(directory), endpoints,
    observer, clock: new FixedClock(), ids: new SeqIds(),
  });

  // addressing the shared role resolves both a and b; b's delivery throws
  const m = await messenger.send({ from: "x", to: "pair", type: "note", parts: [{ kind: "text", text: "hi" }] });

  assert.equal(observed.length, 1, "observed exactly once (no duplicate log entries)");
  assert.equal(observed[0]!.id, m.id);
  assert.ok(attempted.includes("a") && attempted.includes("b"), "both recipients attempted despite b failing");
});

test("rebuild reconstructs full state purely from the observed JSONL log", async () => {
  const { messenger, fs } = setup();
  await messenger.send({ from: "a", to: "b", type: "review_request", parts: [{ kind: "text", text: "PR #1" }] });

  const registry2 = new AgentRegistry();
  const transport2 = new SpyTransport();
  const broker2 = new Broker({
    store: new JsonlStore(fs, ".team/messages.jsonl"),
    registry: registry2, router: new Router(registry2),
    feed: new FeedRenderer(fs, ".team/feed.md"),
    transport: transport2, clock: new FixedClock(), ids: new SeqIds(),
  });
  broker2.register(card({ id: "b", role: "reviewer", subscribes: ["review_request"] }));
  broker2.rebuild();
  assert.equal(broker2.peek("b").length, 1);
  assert.deepEqual(transport2.delivered, []);
});
