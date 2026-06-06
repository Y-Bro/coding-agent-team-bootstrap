import { test } from "node:test";
import assert from "node:assert/strict";
import { DashboardServer } from "../../src/dashboard/server.ts";
import { MessageBus } from "../../src/broker/bus.ts";
import { JsonlStore } from "../../src/broker/store.ts";
import { AgentRegistry } from "../../src/broker/registry.ts";
import { TASK_EVENT_TYPE } from "../../src/broker/tasks.ts";
import { MemoryFs } from "../ports/fakes.ts";
import type { HttpServer, HttpHandler, HttpResponse, SseServer, SseConnection } from "../../src/ports/http.ts";
import type { AgentCard, Message } from "../../src/a2a/index.ts";

/** Captures registered routes + the SSE onConnect so tests invoke them directly. */
class FakeServer implements HttpServer, SseServer {
  routes = new Map<string, HttpHandler>();
  onConnect?: (conn: SseConnection) => (() => void) | void;
  route(method: string, path: string, h: HttpHandler): void { this.routes.set(`${method} ${path}`, h); }
  sse(_path: string, on: (conn: SseConnection) => (() => void) | void): void { this.onConnect = on; }
  async listen(): Promise<void> {}
  async close(): Promise<void> {}
  async get(path: string): Promise<HttpResponse> { return this.routes.get(`GET ${path}`)!({ method: "GET", path, body: "" }); }
}

const card = (id: string, role = "writer"): AgentCard => ({
  id, role, cli: "claude", engine: "claude", capabilities: [], skills: [], workdir: ".", subscribes: [], url: `http://${id}:1`,
});
const taskMsg = (taskId: string, state: string, extra: Record<string, unknown> = {}): Message => ({
  id: `m-${taskId}-${state}`, from: "broker", to: "broker", type: TASK_EVENT_TYPE,
  parts: [{ kind: "data", data: { taskId, state, ...extra } }], ts: "t",
});

function setup() {
  const fs = new MemoryFs();
  const store = new JsonlStore(fs, ".team/messages.jsonl");
  const registry = new AgentRegistry();
  const bus = new MessageBus();
  const server = new FakeServer();
  registry.register(card("a")); registry.register(card("b", "reviewer"));
  new DashboardServer({ server, store, registry, subscriber: bus }).register();
  return { fs, store, registry, bus, server };
}

test("registry endpoint lists the agents", async () => {
  const { server } = setup();
  const res = await server.get("/api/agents");
  const agents = JSON.parse(res.body) as AgentCard[];
  assert.deepEqual(agents.map((a) => a.id).sort(), ["a", "b"]);
  assert.equal(agents.find((a) => a.id === "a")!.url, "http://a:1");
});

test("feed endpoint returns the logged messages", async () => {
  const { store, server } = setup();
  store.append({ id: "m1", from: "a", to: "b", type: "note", parts: [{ kind: "text", text: "hi" }], ts: "t" });
  const res = await server.get("/api/feed");
  const feed = JSON.parse(res.body) as Message[];
  assert.equal(feed.length, 1);
  assert.equal(feed[0]!.id, "m1");
});

test("task-state projection derives task states from the message log", async () => {
  const { store, server } = setup();
  store.append(taskMsg("t1", "submitted", { title: "ship", owner: "a" }));
  store.append(taskMsg("t1", "working"));
  store.append(taskMsg("t2", "submitted", { title: "review", owner: "b" }));
  const tasks = JSON.parse((await server.get("/api/tasks")).body) as Array<{ id: string; state: string; title: string }>;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  assert.equal(byId.get("t1")!.state, "working");   // latest state wins
  assert.equal(byId.get("t1")!.title, "ship");       // title carried forward
  assert.equal(byId.get("t2")!.state, "submitted");
});

test("SSE stream emits a new message event when one is appended (published)", () => {
  const { bus, server } = setup();
  const events: Array<{ data: unknown; event?: string }> = [];
  const conn: SseConnection = { send: (data, event) => events.push({ data, event }) };
  assert.ok(server.onConnect, "an SSE route was registered");
  server.onConnect!(conn); // a client connects → subscribes to the bus

  bus.publish({ id: "m2", from: "a", to: "b", type: "note", parts: [], ts: "t" } as Message);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event, "message");
  assert.equal((events[0]!.data as Message).id, "m2");
});

test("the dashboard serves a static read-only client (no control routes)", async () => {
  const { server } = setup();
  assert.match((await server.get("/")).body, /<title>agent-bootstrap/);
  assert.match((await server.get("/app.js")).body, /EventSource/);
  // READ-ONLY: no send/cancel/control routes exist
  for (const key of server.routes.keys()) {
    assert.doesNotMatch(key, /send|cancel|POST|DELETE|PUT/i, `unexpected control route: ${key}`);
  }
});
