import { createServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { request as httpsRequest } from "node:https";

/** Opt-in TLS material (PEM contents). `ca` lets a client trust a self-signed/private chain. */
export interface TlsServerOptions { cert: string; key: string; ca?: string }
export interface TlsClientOptions { ca?: string; cert?: string; key?: string }

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

/** A live Server-Sent-Events connection: push frames over time, until closed. */
export interface SseConnection {
  /** Send one event (data JSON-encoded; optional event name). */
  send(data: unknown, event?: string): void;
}

/** Server capable of holding open a live SSE route (the dashboard live feed). */
export interface SseServer {
  /** Register a GET SSE route; `onConnect` runs per client and returns a cleanup fn. */
  sse(path: string, onConnect: (conn: SseConnection) => (() => void) | void): void;
}

export class NodeHttpServer implements HttpServer, SseServer {
  private routes = new Map<string, HttpHandler>();
  private sseRoutes = new Map<string, (conn: SseConnection) => (() => void) | void>();
  private server?: Server;

  /** Pass `tls` to listen over HTTPS (default: plain HTTP, nothing changes). */
  constructor(private tls?: TlsServerOptions) {}

  route(method: string, path: string, handler: HttpHandler): void {
    this.routes.set(`${method.toUpperCase()} ${path}`, handler);
  }

  sse(path: string, onConnect: (conn: SseConnection) => (() => void) | void): void {
    this.sseRoutes.set(path, onConnect);
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const onRequest = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
        const path = (req.url ?? "/").split("?")[0] ?? "/";
        const onConnect = (req.method ?? "GET").toUpperCase() === "GET" ? this.sseRoutes.get(path) : undefined;
        if (onConnect) {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
          const conn: SseConnection = {
            send: (data, event) => {
              if (event !== undefined) res.write(`event: ${event}\n`);
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            },
          };
          const cleanup = onConnect(conn);
          req.on("close", () => { if (cleanup) cleanup(); });
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c as Buffer));
        req.on("end", () => {
          void (async () => {
            const handler = this.routes.get(`${(req.method ?? "GET").toUpperCase()} ${path}`);
            if (!handler) { res.statusCode = 404; res.end(""); return; }
            const reqHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(req.headers)) reqHeaders[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
            try {
              const out = await handler({ method: req.method ?? "GET", path, body: Buffer.concat(chunks).toString(), headers: reqHeaders });
              res.statusCode = out.status;
              const resHeaders = out.headers ?? { "content-type": "application/json" };
              for (const [k, v] of Object.entries(resHeaders)) res.setHeader(k, v);
              res.end(out.body);
            } catch (e) {
              // A throwing handler must not hang the request or unhandled-reject:
              // respond 500 with a JSON error body.
              console.error(`http handler error (${path}): ${e instanceof Error ? e.message : e}`);
              res.statusCode = 500;
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ error: "internal error" }));
            }
          })();
        });
      };
      this.server = this.tls
        ? createHttpsServer({ cert: this.tls.cert, key: this.tls.key, ca: this.tls.ca }, onRequest)
        : createServer(onRequest);
      // A bind failure (e.g. EADDRINUSE) must reject the listen promise rather
      // than emit an unhandled 'error' that crashes the process.
      const onListenError = (err: unknown) => reject(err);
      this.server.once("error", onListenError);
      this.server.listen(port, () => {
        this.server!.removeListener("error", onListenError);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server ? this.server.close(() => resolve()) : resolve());
  }
}

export class NodeHttpClient implements HttpClient {
  /** Pass `tls` to trust a custom CA / present a client cert on HTTPS calls. */
  constructor(private tls?: TlsClientOptions) {}

  async request(url: string, init: { method: string; body?: string; headers?: Record<string, string> }): Promise<HttpResponse> {
    const headers = {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    };
    // HTTPS with explicit TLS material (e.g. a self-signed/private CA) goes via
    // node:https so the CA is honored; everything else uses the default fetch path.
    if (this.tls && url.startsWith("https:")) {
      return this.requestTls(url, init.method, init.body, headers);
    }
    const res = await fetch(url, { method: init.method, body: init.body, headers });
    const out: Record<string, string> = {};
    res.headers.forEach((v, k) => { out[k] = v; });
    return { status: res.status, body: await res.text(), headers: out };
  }

  private requestTls(url: string, method: string, body: string | undefined, headers: Record<string, string>): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      const req = httpsRequest(url, { method, headers, ca: this.tls!.ca, cert: this.tls!.cert, key: this.tls!.key }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) out[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), headers: out });
        });
      });
      req.on("error", reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }
}
