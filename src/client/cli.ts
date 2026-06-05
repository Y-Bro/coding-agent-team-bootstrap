import { Command } from "commander";

export interface ClientLike {
  send(p: { from: string; to: string; type: string; parts: { kind: "text"; text: string }[]; task?: string }): Promise<unknown>;
  inbox(agentId: string): Promise<any[]>;
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
    .argument("<body>")
    .action(async (body: string, opts: { to: string; type: string; task?: string }) => {
      await client.send({ from: agentId, to: opts.to, type: opts.type, task: opts.task, parts: [{ kind: "text", text: body }] });
      print(`sent ${opts.type} → ${opts.to}`);
    });

  program.command("inbox").action(async () => {
    const msgs = await client.inbox(agentId);
    if (msgs.length === 0) { print("(empty)"); return; }
    for (const m of msgs) {
      const text = m.parts.map((p: any) => (p.kind === "text" ? p.text : `[${p.kind}]`)).join(" ");
      print(`${m.from} ${m.type}: ${text}`);
    }
  });

  program.command("ps").action(async () => {
    for (const a of await client.list()) print(`${a.id}\t${a.role}`);
  });

  return program;
}
