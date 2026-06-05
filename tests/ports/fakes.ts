import type { Clock } from "../../src/ports/clock.ts";
import type { IdGenerator } from "../../src/ports/ids.ts";
import type { FileSystem } from "../../src/ports/fs.ts";

export class FixedClock implements Clock {
  constructor(private iso = "2026-06-06T00:00:00.000Z") {}
  now(): Date { return new Date(this.iso); }
  isoNow(): string { return this.iso; }
}

export class SeqIds implements IdGenerator {
  private n = 0;
  next(prefix = "m"): string { return `${prefix}${++this.n}`; }
}

export class MemoryFs implements FileSystem {
  files = new Map<string, string>();
  append(path: string, data: string): void { this.files.set(path, (this.files.get(path) ?? "") + data); }
  read(path: string): string {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT: ${path}`);
    return v;
  }
  write(path: string, data: string): void { this.files.set(path, data); }
  exists(path: string): boolean { return this.files.has(path); }
}
