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

if (process.argv[2] === "new") {
  const { runScaffoldCommand } = await import("../src/compose.ts");
  const { ScriptedPrompter } = await import("../src/ports/prompter.ts");
  const rest = process.argv.slice(3);
  const yes = rest.includes("--yes");
  const noGuidance = rest.includes("--no-guidance");
  const outIdx = rest.indexOf("--out");
  const out = outIdx >= 0 && rest[outIdx + 1] ? rest[outIdx + 1]! : "team.yaml";
  // --yes: drive a solo/panes default headlessly (name, runtime=1, preset=1=solo,
  // engine, window(agent)=agent, confirm=n). Mirrors `team init --yes`.
  const deps = yes
    ? { prompter: new ScriptedPrompter(["team", "1", "1", "claude", "agent", "n"]) }
    : {};
  await runScaffoldCommand({ out, noGuidance }, deps);
  console.log(`Wrote ${out}`);
  process.exit(0);
}

// Lifecycle verbs (`team up` / `team down`) run the composition root: start the
// broker daemon and bootstrap (or tear down) the team described by team.yaml.
if (process.argv[2] === "up" || process.argv[2] === "down") {
  const { loadConfig, resolveBase, resolveConfigPaths } = await import("../src/config/index.ts");
  const { buildContainer } = await import("../src/compose.ts");
  const { teamUp, teamDown } = await import("../src/client/lifecycle.ts");
  const { NodeFileSystem } = await import("../src/ports/fs.ts");
  const { readFileSync, existsSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");

  const configPath = process.env.TEAM_CONFIG ?? "team.yaml";
  // Run-from-anywhere: resolve every config path against the project base so the
  // team + its .team artifacts live where the config does, not the cwd.
  const base = resolveBase(loadConfig(configPath), configPath);
  const cfg = resolveConfigPaths(loadConfig(configPath), base);

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
    // --detach (-d): spawn a detached child running the normal foreground up
    // path (without --detach), then free this terminal. The child holds the
    // event loop and writes broker.pid (its own pid) via teamUp, so `team down`
    // signals the right process.
    const upArgs = process.argv.slice(3);
    if (upArgs.includes("--detach") || upArgs.includes("-d")) {
      const { spawn } = await import("node:child_process");
      const { fileURLToPath } = await import("node:url");
      // Re-spawn through the bash launcher (absolute path) — NOT `node --import
      // tsx` — so the child boots its local tsx from any cwd, like the parent.
      const launcher = fileURLToPath(new URL("./team", import.meta.url));
      const child = spawn(launcher, ["up"], {
        detached: true, stdio: "ignore", cwd: process.cwd(), env: process.env,
      });
      child.unref();
      console.log(`team up (detached): ${cfg.name} — broker on ${socketPath} (\`team down\` to stop)`);
      process.exit(0);
    }
    const { BrokerAlreadyRunningError } = await import("../src/ports/transport.ts");
    try {
      const { daemon, bootstrapper, dashboard, sweep } = buildContainer(cfg, templates);
      await teamUp(daemon, bootstrapper, socketPath, { fs, proc, pidfile, socket: socketPath });
      console.log(`team up: ${cfg.name} — ${cfg.agents.length} agents on ${socketPath} (Ctrl-C or \`team down\` to stop)`);
      // Liveness sweep runs alongside the broker; stop it on clean shutdown.
      void sweep.start();
      proc.onShutdown(() => sweep.stop());
      if (dashboard) {
        await dashboard.server.listen(dashboard.port);
        console.log(`dashboard (read-only): http://${cfg.servers.host}:${dashboard.port}`);
      }
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

// Client verbs only. Setup/lifecycle verbs are handled above; `up` deliberately
// does NOT exit (the socket keeps the event loop alive), so it must NOT fall
// through to commander here — that would print "unknown command up" and exit(1),
// killing the just-started broker.
if (!["doctor", "init", "up", "down", "new"].includes(process.argv[2] ?? "")) {
  const client = new BrokerClient(new NodeSocketClient(), socket);
  const program = buildProgram(client, agentId, (s) => console.log(s));

  program.parseAsync(process.argv).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
