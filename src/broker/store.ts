import type { FileSystem } from "../ports/fs.ts";
import { isMessage, type Message } from "../a2a/index.ts";

export interface MessageStore {
  append(m: Message): void;
  replay(): Message[];
}

export class JsonlStore implements MessageStore {
  constructor(private fs: FileSystem, private path: string) {}

  append(m: Message): void {
    this.fs.append(this.path, JSON.stringify(m) + "\n");
  }

  replay(): Message[] {
    if (!this.fs.exists(this.path)) return [];
    return this.fs
      .read(this.path)
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l))
      .filter(isMessage);
  }
}
