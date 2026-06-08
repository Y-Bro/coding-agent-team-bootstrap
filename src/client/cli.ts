import { Command } from "commander";
import { trace } from "../obs/trace.ts";

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
    .argument("<body>")
    .action(async (body: string, opts: { to: string; type: string; task?: string }) => {
      trace("cli", `send: from=${agentId} to=${opts.to} type=${opts.type}${opts.task ? ` task=${opts.task}` : ""}`);
      await client.send({ from: agentId, to: opts.to, type: opts.type, task: opts.task, parts: [{ kind: "text", text: body }] });
      print(`sent ${opts.type} → ${opts.to}`);
    });

  program.command("inbox").action(async () => {
    trace("cli", `inbox: peek for ${agentId} → print → ack`);
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
    trace("cli", "ps: list roster");
    for (const a of await client.list()) print(`${a.id}\t${a.role}`);
  });

  return program;
}
