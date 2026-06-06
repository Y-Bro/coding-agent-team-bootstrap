import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";

export interface FileSystem {
  append(path: string, data: string): void;
  read(path: string): string;
  write(path: string, data: string): void;
  exists(path: string): boolean;
  /** Remove a file; removing a missing path is a no-op. */
  remove(path: string): void;
}

export class NodeFileSystem implements FileSystem {
  private ensureDir(path: string): void { mkdirSync(dirname(path), { recursive: true }); }
  append(path: string, data: string): void { this.ensureDir(path); appendFileSync(path, data); }
  read(path: string): string { return readFileSync(path, "utf8"); }
  write(path: string, data: string): void { this.ensureDir(path); writeFileSync(path, data); }
  exists(path: string): boolean { return existsSync(path); }
  remove(path: string): void { rmSync(path, { force: true }); }
}
