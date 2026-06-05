import type { FileSystem } from "../ports/fs.ts";
import type { Message } from "../a2a/index.ts";

/** Narrow contract for appending a message to the human-readable feed. */
export interface FeedWriter {
  append(m: Message): void;
}

export class FeedRenderer implements FeedWriter {
  constructor(private fs: FileSystem, private path: string) {}

  append(m: Message): void {
    const text = m.parts
      .map((p) => (p.kind === "text" ? p.text : `[${p.kind}]`))
      .join(" ");
    const line = `- \`${m.ts}\` **${m.from} → ${m.to}** _${m.type}_: ${text}\n`;
    this.fs.append(this.path, line);
  }
}
