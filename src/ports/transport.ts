import { createServer, createConnection, type Server, type Socket } from "node:net";

export interface SocketServer {
  listen(path: string, onMessage: (msg: unknown, reply: (r: unknown) => void) => void): Promise<void>;
  close(): Promise<void>;
}

export interface SocketClient {
  request(path: string, msg: unknown): Promise<unknown>;
}

export class NodeSocketServer implements SocketServer {
  private server?: Server;
  listen(path: string, onMessage: (msg: unknown, reply: (r: unknown) => void) => void): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((sock: Socket) => {
        let buf = "";
        sock.on("data", (chunk) => {
          buf += chunk.toString();
          let idx: number;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
            if (line.trim() === "") continue;
            onMessage(JSON.parse(line), (r) => sock.write(JSON.stringify(r) + "\n"));
          }
        });
      });
      this.server.listen(path, () => resolve());
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
