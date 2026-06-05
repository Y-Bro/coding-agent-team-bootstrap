import type { FileSystem } from "../ports/fs.ts";
import type { Message } from "../a2a/index.ts";

export class FeedRenderer {
  constructor(private fs: FileSystem, private path: string) {}

  append(m: Message): void {
    const text = m.parts
      .map((p) => (p.kind === "text" ? p.text : `[${p.kind}]`))
      .join(" ");
    const line = `- \`${m.ts}\` **${m.from} → ${m.to}** _${m.type}_: ${text}\n`;
    this.fs.append(this.path, line);
  }
}
