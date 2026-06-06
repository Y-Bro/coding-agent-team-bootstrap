import type { HttpServer, HttpResponse, SseServer } from "../ports/http.ts";
import type { MessageStore } from "../broker/store.ts";
import type { AgentDirectory } from "../broker/registry.ts";
import type { MessageSubscriber } from "../broker/bus.ts";
import { projectTasks } from "../broker/tasks.ts";
import { INDEX_HTML, APP_JS } from "./client.ts";

export interface DashboardDeps {
  /** Its own HTTP server (own port) with live-SSE support. */
  server: HttpServer & SseServer;
  /** The durable message log (read-only). */
  store: MessageStore;
  /** The agent roster (read-only). */
  registry: AgentDirectory;
  /** Live recorded-message stream (the broker's MessageBus). */
  subscriber: MessageSubscriber;
}

function json(value: unknown): HttpResponse { return { status: 200, body: JSON.stringify(value) }; }
function page(body: string, type: string): HttpResponse { return { status: 200, body, headers: { "content-type": type } }; }

/**
 * v3-m4 READ-ONLY observability dashboard. Serves the agent roster, the durable
 * message feed, derived task states, and a live SSE stream of new messages, plus
 * a static vanilla-JS client. There are deliberately NO send/cancel/control
 * routes — the dashboard only reads broker state behind injected seams.
 */
export class DashboardServer {
  constructor(private deps: DashboardDeps) {}

  register(): void {
    const { server, store, registry, subscriber } = this.deps;
    server.route("GET", "/", () => page(INDEX_HTML, "text/html; charset=utf-8"));
    server.route("GET", "/app.js", () => page(APP_JS, "text/javascript; charset=utf-8"));
    server.route("GET", "/api/agents", () => json(registry.all()));
    server.route("GET", "/api/feed", () => json(store.replay()));
    server.route("GET", "/api/tasks", () => json(projectTasks(store.replay())));
    // Live feed: push each newly recorded message as a "message" event.
    server.sse("/events", (conn) => subscriber.subscribe((m) => conn.send(m, "message")));
  }

  async listen(port: number): Promise<void> { await this.deps.server.listen(port); }
  async close(): Promise<void> { await this.deps.server.close(); }
}
