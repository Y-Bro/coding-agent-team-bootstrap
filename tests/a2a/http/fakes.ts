import type { HttpServer, HttpClient, HttpHandler, HttpRequest, HttpResponse } from "../../../src/ports/http.ts";

/** In-memory HttpServer: records routes and dispatches requests to them. */
export class FakeHttpServer implements HttpServer {
  routes = new Map<string, HttpHandler>();
  listening = false;

  route(method: string, path: string, handler: HttpHandler): void {
    this.routes.set(`${method.toUpperCase()} ${path}`, handler);
  }
  async listen(): Promise<void> { this.listening = true; }
  async close(): Promise<void> { this.listening = false; }

  async handle(req: HttpRequest): Promise<HttpResponse> {
    const h = this.routes.get(`${req.method.toUpperCase()} ${req.path}`);
    if (!h) return { status: 404, body: "" };
    return h(req);
  }
}

/** In-memory HttpClient that dispatches into a FakeHttpServer for contract tests. */
export class FakeHttpClient implements HttpClient {
  constructor(private server: FakeHttpServer, private base: string) {}
  async request(url: string, init: { method: string; body?: string; headers?: Record<string, string> }): Promise<HttpResponse> {
    const path = url.startsWith(this.base) ? url.slice(this.base.length) : url;
    return this.server.handle({ method: init.method, path, body: init.body ?? "", headers: init.headers });
  }
}
