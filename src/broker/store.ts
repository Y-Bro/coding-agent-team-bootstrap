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
    const msgs = this.fs
      .read(this.path)
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l))
      .filter(isMessage);
    trace("store", `replay ${this.path} → ${msgs.length} messages`);
    return msgs;
  }
}
