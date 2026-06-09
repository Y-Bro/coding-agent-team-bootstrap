import { createServer, createConnection, type Server, type Socket } from "node:net";
import { existsSync, unlinkSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

export interface SocketServer {
  listen(path: string, onMessage: (msg: unknown, reply: (r: unknown) => void) => void): Promise<void>;
  close(): Promise<void>;
}

export interface SocketClient {
  request(path: string, msg: unknown): Promise<unknown>;
}

/** Raised when a live broker already owns the socket — never an unhandled EADDRINUSE. */
export class BrokerAlreadyRunningError extends Error {
  readonly code = "EADDRINUSE";
  constructor() {
    super("broker already running — run team down");
    this.name = "BrokerAlreadyRunningError";
  }
}

/** Probe whether a unix socket has a live listener (true if a connection succeeds). */
export function probeLiveSocket(path: string, timeoutMs = 250): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection(path);
    const done = (live: boolean) => { sock.destroy(); resolve(live); };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

export class NodeSocketServer implements SocketServer {
  private server?: Server;

  async listen(path: string, onMessage: (msg: unknown, reply: (r: unknown) => void) => void): Promise<void> {
    // Ensure the socket's parent dir (e.g. .team/) exists — on a fresh clone it
    // doesn't, and binding would otherwise crash with ENOENT/EACCES. Restrict it
    // to the owner (0700) so the broker socket isn't world-traversable.
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

    // Stale-socket handling: if the path exists, a live owner means we refuse
    // (clear error); a dead leftover from a crash is unlinked so we can bind.
    if (existsSync(path)) {
      if (await probeLiveSocket(path)) throw new BrokerAlreadyRunningError();
      unlinkSync(path);
    }

    await new Promise<void>((resolve, reject) => {
      const server = createServer((sock: Socket) => {
        let buf = "";
        sock.on("data", (chunk) => {
          buf += chunk.toString();
          let idx: number;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
            if (line.trim() === "") continue;
            let parsed: unknown;
            try {
              parsed = JSON.parse(line);
            } catch {
              // A malformed frame must not crash the daemon's data handler: reply
              // with a structured error and keep processing the rest of the stream.
              sock.write(JSON.stringify({ ok: false, error: "malformed JSON frame" }) + "\n");
              continue;
            }
            onMessage(parsed, (r) => sock.write(JSON.stringify(r) + "\n"));
          }
        });
      });
      this.server = server;
      // Bind-time errors reject the listen promise instead of throwing unhandled.
      const onListenError = (err: NodeJS.ErrnoException) => {
        reject(err.code === "EADDRINUSE" ? new BrokerAlreadyRunningError() : err);
      };
      server.once("error", onListenError);
      server.listen(path, () => {
        server.removeListener("error", onListenError);
        // Restrict the socket to the owner (0600) so other local users can't
        // connect to the broker. Best-effort: platforms without chmod just skip.
        try { chmodSync(path, 0o600); } catch { /* unsupported FS/platform */ }
        // Keep a persistent handler so a later socket error never crashes the daemon.
        server.on("error", (e) => console.error(`broker socket error: ${e instanceof Error ? e.message : e}`));
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server ? this.server.close(() => resolve()) : resolve());
  }
}

export class NodeSocketClient implements SocketClient {
  request(path: string, msg: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const sock = createConnection(path);
      let buf = "";
      sock.on("error", reject);
      sock.on("connect", () => sock.write(JSON.stringify(msg) + "\n"));
      sock.on("data", (chunk) => {
        buf += chunk.toString();
        const idx = buf.indexOf("\n");
        if (idx >= 0) { sock.end(); resolve(JSON.parse(buf.slice(0, idx))); }
      });
    });
  }
}
