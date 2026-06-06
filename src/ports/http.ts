import { createServer, type Server } from "node:http";

/** A received HTTP request (method + path + raw body + lowercased headers). */
export interface HttpRequest {
  method: string;
  path: string;
  body: string;
  headers?: Record<string, string>;
}

/** An HTTP response (status + raw body + optional response headers). */
export interface HttpResponse {
  status: number;
  body: string;
  /** Response headers; when absent the server defaults content-type to application/json. */
  headers?: Record<string, string>;
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
  request(url: string, init: { method: string; body?: string; headers?: Record<string, string> }): Promise<HttpResponse>;
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
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
            const out = await handler({ method: req.method ?? "GET", path, body: Buffer.concat(chunks).toString(), headers });
            res.statusCode = out.status;
            const headers = out.headers ?? { "content-type": "application/json" };
            for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
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
  async request(url: string, init: { method: string; body?: string; headers?: Record<string, string> }): Promise<HttpResponse> {
    const res = await fetch(url, {
      method: init.method,
      body: init.body,
      headers: {
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { status: res.status, body: await res.text(), headers };
  }
}
