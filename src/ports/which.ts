// src/ports/which.ts
import { execFile } from "node:child_process";

export interface CommandLocator {
  has(command: string): Promise<boolean>;
}

export class NodeWhich implements CommandLocator {
  has(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      // `command -v` is POSIX; on the supported macOS/Linux dev envs this is fine.
      execFile("/bin/sh", ["-c", `command -v ${command}`], (err) => resolve(!err));
    });
  }
}

export class FakeWhich implements CommandLocator {
  constructor(private present: Set<string>) {}
  async has(command: string): Promise<boolean> {
    return this.present.has(command);
  }
}
