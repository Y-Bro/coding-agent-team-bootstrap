// src/ports/which.ts
import { promises as fs, constants as fsConstants } from "node:fs";
import { join, delimiter } from "node:path";

export interface CommandLocator {
  has(command: string): Promise<boolean>;
}

// A bare executable name: no path separators, no shell metacharacters, no spaces.
const BARE_EXECUTABLE = /^[A-Za-z0-9._-]+$/;

export class NodeWhich implements CommandLocator {
  async has(command: string): Promise<boolean> {
    // Reject anything that isn't a plain executable name. This prevents shell
    // metacharacters/paths from being interpreted and avoids any shell at all.
    if (!BARE_EXECUTABLE.test(command)) return false;

    const pathEnv = process.env.PATH ?? "";
    for (const dir of pathEnv.split(delimiter)) {
      if (!dir) continue;
      try {
        await fs.access(join(dir, command), fsConstants.X_OK);
        return true;
      } catch {
        // not here / not executable; keep searching
      }
    }
    return false;
  }
}

export class FakeWhich implements CommandLocator {
  constructor(private present: Set<string>) {}
  async has(command: string): Promise<boolean> {
    return this.present.has(command);
  }
}
