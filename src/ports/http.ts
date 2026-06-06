import { createServer, type Server } from "node:http";

/** A received HTTP request (method + path + raw body). */
export interface HttpRequest {
  method: string;
  path: string;
  body: string;
}

/** An HTTP response (status + raw body). */
export interface HttpResponse {
  status: number;
  body: string;
}

export type HttpHandler = (req: HttpRequest) => Promise<HttpResponse> | HttpResponse;

/**
 * Minimal HTTP server seam: register method+path routes, listen, close. Concrete
 * Node impl lives here; units inject a fake so the A2A server tests headlessly.
 */
export interface HttpServer {
  route(method: string, path: string, handler: HttpHandler): void;
  listen(port: number): Promise<void>;
  close(): Promise<void>;
}

/** Minimal HTTP client seam: issue a request to a full URL, get a response. */
export interface HttpClient {
  request(url: string, init: { method: string; body?: string }): Promise<HttpResponse>;
}

export class NodeHttpServer implements HttpServer {
  private routes = new Map<string, HttpHandler>();
  private server?: Server;

  route(method: string, path: string, handler: HttpHandler): void {
    this.routes.set(`${method.toUpperCase()} ${path}`, handler);
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c as Buffer));
        req.on("end", () => {
          void (async () => {
            const path = (req.url ?? "/").split("?")[0] ?? "/";
            const handler = this.routes.get(`${(req.method ?? "GET").toUpperCase()} ${path}`);
            if (!handler) { res.statusCode = 404; res.end(""); return; }
            const out = await handler({ method: req.method ?? "GET", path, body: Buffer.concat(chunks).toString() });
            res.statusCode = out.status;
            res.setHeader("content-type", "application/json");
            res.end(out.body);
          })();
        });
      });
      this.server.listen(port, () => resolve());
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server ? this.server.close(() => resolve()) : resolve());
  }
}

export class NodeHttpClient implements HttpClient {
  async request(url: string, init: { method: string; body?: string }): Promise<HttpResponse> {
    const res = await fetch(url, {
      method: init.method,
      body: init.body,
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    });
    return { status: res.status, body: await res.text() };
  }
}
