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

export class NodeHttpServer implements HttpServer {
  private routes = new Map<string, HttpHandler>();
  private server?: Server;

  /** Pass `tls` to listen over HTTPS (default: plain HTTP, nothing changes). */
  constructor(private tls?: TlsServerOptions) {}

  route(method: string, path: string, handler: HttpHandler): void {
    this.routes.set(`${method.toUpperCase()} ${path}`, handler);
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      const onRequest = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c as Buffer));
        req.on("end", () => {
          void (async () => {
            const path = (req.url ?? "/").split("?")[0] ?? "/";
            const handler = this.routes.get(`${(req.method ?? "GET").toUpperCase()} ${path}`);
            if (!handler) { res.statusCode = 404; res.end(""); return; }
            const reqHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(req.headers)) reqHeaders[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
            const out = await handler({ method: req.method ?? "GET", path, body: Buffer.concat(chunks).toString(), headers: reqHeaders });
            res.statusCode = out.status;
            const resHeaders = out.headers ?? { "content-type": "application/json" };
            for (const [k, v] of Object.entries(resHeaders)) res.setHeader(k, v);
            res.end(out.body);
          })();
        });
      };
      this.server = this.tls
        ? createHttpsServer({ cert: this.tls.cert, key: this.tls.key, ca: this.tls.ca }, onRequest)
        : createServer(onRequest);
      this.server.listen(port, () => resolve());
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
