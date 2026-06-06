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
  const { readFileSync, existsSync } = await import("node:fs");

  const configPath = process.env.TEAM_CONFIG ?? "team.yaml";
  const cfg = loadConfig(configPath);

  // Read each distinct role template the config references (template name, else role).
  const templates: Record<string, string> = {};
  for (const a of cfg.agents) {
    const name = a.template ?? a.role;
    const path = `templates/${name}.md`;
    if (templates[name] === undefined && existsSync(path)) templates[name] = readFileSync(path, "utf8");
  }

  const { daemon, bootstrapper } = buildContainer(cfg, templates);
  const socketPath = cfg.broker.socket;
  if (process.argv[2] === "up") {
    await daemon.start(socketPath);
    await bootstrapper.up(socketPath);
    console.log(`team up: ${cfg.name} — ${cfg.agents.length} agents on ${socketPath}`);
  } else {
    await bootstrapper.down();
    await daemon.stop();
    console.log(`team down: ${cfg.name}`);
  }
  process.exit(0);
}

const client = new BrokerClient(new NodeSocketClient(), socket);
const program = buildProgram(client, agentId, (s) => console.log(s));

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
