import { Command } from "commander";

export interface ClientLike {
  send(p: { from: string; to: string; type: string; parts: { kind: "text"; text: string }[]; task?: string }): Promise<unknown>;
  peek(agentId: string): Promise<any[]>;
  ack(agentId: string, ids: string[]): Promise<void>;
  list(): Promise<any[]>;
}

/** Build the commander program around an injected client + this agent's id. */
export function buildProgram(client: ClientLike, agentId: string, print: (s: string) => void): Command {
  const program = new Command();
  program.name("team").exitOverride();

  program.command("send")
    .requiredOption("--to <target>")
    .requiredOption("--type <type>")
    .option("--task <id>")
    .option("--text <text>")
    .argument("[body]")
    .action(async (body: string | undefined, opts: { to: string; type: string; task?: string; text?: string }) => {
      if (body !== undefined && opts.text !== undefined) throw new Error("provide message text once: positional OR --text, not both");
      const text = body ?? opts.text;
      if (text === undefined) throw new Error("message text required: pass a positional body or --text");
      await client.send({ from: agentId, to: opts.to, type: opts.type, task: opts.task, parts: [{ kind: "text", text }] });
      print(`sent ${opts.type} → ${opts.to}`);
    });

  program.command("inbox").action(async () => {
    const msgs = await client.peek(agentId);
    if (msgs.length === 0) { print("(empty)"); return; }
    for (const m of msgs) {
      const text = m.parts.map((p: any) => (p.kind === "text" ? p.text : `[${p.kind}]`)).join(" ");
      print(`${m.from} ${m.type}: ${text}`);
    }
    // at-least-once: ack only after the messages have been printed (consumed).
    await client.ack(agentId, msgs.map((m) => m.id));
  });

  program.command("ps").action(async () => {
    for (const a of await client.list()) print(`${a.id}\t${a.role}`);
  });

  return program;
}
