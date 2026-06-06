#!/usr/bin/env -S node --import tsx
import { NodeSocketClient } from "../src/ports/transport.ts";
import { BrokerClient } from "../src/client/rpc.ts";
import { buildProgram } from "../src/client/cli.ts";

const agentId = process.env.TEAM_AGENT_ID ?? "operator";
const socket = process.env.TEAM_SOCKET ?? ".team/broker.sock";

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
  };

  if (process.argv[2] === "up") {
    const { daemon, bootstrapper } = buildContainer(cfg, templates);
    await teamUp(daemon, bootstrapper, socketPath, { fs, proc, pidfile });
    console.log(`team up: ${cfg.name} — ${cfg.agents.length} agents on ${socketPath} (Ctrl-C or \`team down\` to stop)`);
    // No process.exit: the socket server holds the event loop open so the broker
    // stays reachable for later `team send`/`team inbox`.
  } else {
    const ok = await teamDown({ fs, proc, pidfile });
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
