import { NodeSocketClient } from "../src/ports/transport.ts";
import { BrokerClient } from "../src/client/rpc.ts";
import { buildProgram } from "../src/client/cli.ts";

const agentId = process.env.TEAM_AGENT_ID ?? "operator";
const socket = process.env.TEAM_SOCKET ?? ".team/broker.sock";

// Setup verbs (`team doctor` / `team init`) run their own composition roots and
// exit; they don't touch the broker socket.
if (process.argv[2] === "doctor") {
  const { runDoctorCommand } = await import("../src/compose.ts");
  const { report, text } = await runDoctorCommand();
  console.log(text);
  process.exit(report.ok ? 0 : 1);
}

if (process.argv[2] === "init") {
  const { runInitCommand } = await import("../src/compose.ts");
  const rest = process.argv.slice(3);
  const yes = rest.includes("--yes");
  const outIdx = rest.indexOf("--out");
  const out = outIdx >= 0 && rest[outIdx + 1] ? rest[outIdx + 1]! : "team.yaml";
  const confirmUp = (p: { confirm(q: string, fallback?: boolean): Promise<boolean> }) =>
    p.confirm("Bring the team up now?", false);
  const { wantsUp } = await runInitCommand({ yes, out }, confirmUp);
  console.log(`Wrote ${out}`);
  if (wantsUp) {
    console.log(`Run \`TEAM_CONFIG=${out} team up\` to start the team.`);
  }
  process.exit(0);
}

// Lifecycle verbs (`team up` / `team down`) run the composition root: start the
// broker daemon and bootstrap (or tear down) the team described by team.yaml.
if (process.argv[2] === "up" || process.argv[2] === "down") {
  const { loadConfig } = await import("../src/config/index.ts");
  const { buildContainer } = await import("../src/compose.ts");
  const { teamUp, teamDown } = await import("../src/client/lifecycle.ts");
  const { NodeFileSystem } = await import("../src/ports/fs.ts");
  const { readFileSync, existsSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");

  const configPath = process.env.TEAM_CONFIG ?? "team.yaml";
  const cfg = loadConfig(configPath);

  // Read each distinct role template the config references (template name, else role).
  const templates: Record<string, string> = {};
  for (const a of cfg.agents) {
    const name = a.template ?? a.role;
    const path = `templates/${name}.md`;
    if (templates[name] === undefined && existsSync(path)) templates[name] = readFileSync(path, "utf8");
  }

  const socketPath = cfg.broker.socket;
  const pidfile = join(dirname(socketPath), "broker.pid");
  const fs = new NodeFileSystem();
  const proc = {
    pid: process.pid,
    kill: (pid: number, signal: string) => { process.kill(pid, signal); },
    onShutdown: (handler: () => void) => { process.on("SIGINT", handler); process.on("SIGTERM", handler); },
    onExit: (handler: () => void) => { process.on("exit", handler); },
  };

  if (process.argv[2] === "up") {
    const { BrokerAlreadyRunningError } = await import("../src/ports/transport.ts");
    try {
      const { daemon, bootstrapper } = buildContainer(cfg, templates);
      await teamUp(daemon, bootstrapper, socketPath, { fs, proc, pidfile, socket: socketPath });
      console.log(`team up: ${cfg.name} — ${cfg.agents.length} agents on ${socketPath} (Ctrl-C or \`team down\` to stop)`);
      // No process.exit: the socket server holds the event loop open so the broker
      // stays reachable for later `team send`/`team inbox`.
    } catch (e) {
      if (e instanceof BrokerAlreadyRunningError) { console.error(e.message); process.exit(1); }
      throw e;
    }
  } else {
    const ok = await teamDown({ fs, proc, pidfile, socket: socketPath });
    console.log(ok ? `team down: ${cfg.name}` : "team down: no running broker (no pidfile)");
    process.exit(ok ? 0 : 1);
  }
}

const client = new BrokerClient(new NodeSocketClient(), socket);
const program = buildProgram(client, agentId, (s) => console.log(s));

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
