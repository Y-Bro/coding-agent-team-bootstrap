import type { FileSystem } from "../ports/fs.ts";
import { isMessage, type Message } from "../a2a/index.ts";
import { trace } from "../obs/trace.ts";

export interface MessageStore {
  append(m: Message): void;
  replay(): Message[];
}

export class JsonlStore implements MessageStore {
  constructor(private fs: FileSystem, private path: string) {}

  append(m: Message): void {
    trace("store", `append ${m.id} (${m.type}) → ${this.path}`);
    this.fs.append(this.path, JSON.stringify(m) + "\n");
  }

  replay(): Message[] {
    if (!this.fs.exists(this.path)) return [];
    const out: Message[] = [];
    for (const line of this.fs.read(this.path).split("\n")) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // A single corrupt line (e.g. a partial write from a crash) must not block
        // the whole rebuild — skip it and keep replaying the rest of the log.
        trace("store", "skip corrupt JSONL line during replay (best-effort)");
        console.error("store: skipping malformed JSONL line during replay");
        continue;
      }
      if (isMessage(parsed)) out.push(parsed);
    }
    trace("store", `replay ${this.path} → ${out.length} messages`);
    return out;
  }
}
