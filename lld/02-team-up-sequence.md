# 2. `team up` — bootstrap + launch sequence

**Entry:** `bin/team.ts` (`process.argv[2] === "up"`). Drives
`teamUp(daemon, bootstrapper, socket, deps)` in `src/client/lifecycle.ts`, which
calls `Bootstrapper.up` in `src/bootstrap/bootstrapper.ts`.

## Sequence

```mermaid
sequenceDiagram
  autonumber
  actor U as user
  participant BIN as bin/team.ts
  participant CFG as config/loader+resolve
  participant CMP as compose.buildContainer
  participant LC as lifecycle.teamUp
  participant DM as BrokerDaemon
  participant BS as Bootstrapper.up
  participant GIT as createWorktrees
  participant RT as Runtime (panes)
  participant TMUX as NodeTmux

  U->>BIN: team up  (TEAM_CONFIG=team.yaml)
  BIN->>CFG: loadConfig + resolveBase + resolveConfigPaths
  CFG-->>BIN: cfg (absolute paths)
  BIN->>BIN: read templates/<role>.md
  BIN->>CMP: buildContainer(cfg, templates)
  CMP-->>BIN: {daemon, bootstrapper, dashboard, sweep}
  BIN->>LC: teamUp(daemon, bootstrapper, socket, deps)
  LC->>DM: daemon.start(socket)
  DM->>DM: NodeSocketServer.listen(socket, handler)
  LC->>BS: bootstrapper.up(socket)
  BS->>GIT: createWorktrees(cfg, git, base)
  loop each agent (config order)
    BS->>BS: card = stampCard(toCard(agent))
    BS->>CMP: register(card)  (broker roster)
    BS->>BS: fs.write .team/cards/<id>.json
    BS->>BS: fs.write <workdir>/<roleFile> = renderRoleFile(template, agent)
  end
  loop each agent (config order)
    BS->>RT: runtime.spawn(card, {config, socketPath})
    RT->>TMUX: placePane (new-session | new-window | split-window)
    RT->>TMUX: send-keys -l "<launch cmd>"  (type)
    RT->>RT: sleeper.sleep(400ms)
    RT->>TMUX: send-keys Enter             (submit)
  end
  LC->>LC: fs.write pidfile = pid
  BIN->>BIN: sweep.start()  (background loop)
  Note over BIN: process stays alive — socket holds the event loop
```

## Step detail (file:function)

- **Config load** — `bin/team.ts`: `loadConfig(configPath)` (`config/loader.ts`,
  Zod parse via `TeamConfigSchema`), `resolveBase(cfg, configPath)` and
  `resolveConfigPaths(cfg, base)` (`config/resolve.ts`) make socket/workdirs/
  worktree paths absolute against the **project base** (run-from-anywhere).
- **Templates** — for each distinct `agent.template ?? agent.role`, read
  `templates/<name>.md` if present (role-file body source).
- **`daemon.start`** — `BrokerDaemon.start` (`broker/daemon.ts`) →
  `NodeSocketServer.listen(socketPath, handler)`. `EADDRINUSE`/bind collision →
  `BrokerAlreadyRunningError` (the "already running" guard).
- **`createWorktrees`** — `bootstrap/worktrees.ts`: for each agent declaring a
  `worktree`, runs `git worktree add <path> <branch>` inside the base repo.
  Early-returns (no git calls) when no agent declares a worktree.
- **Card + role file** — `bootstrap/roles.ts`:
  - `toCard(agent)` → the published `AgentCard`.
  - `roleFileName(agent, engines)` → engine's `roleFile` (CLAUDE.md/AGENTS.md/…).
  - `renderRoleFile(template, agent)` → substitutes `{{id}}`, `{{role}}`, etc.
  - Two agents sharing the same workdir+engine collide on one role file → warn,
    last write wins (panes teams use `workdir: shared/<id>` to avoid this).
- **`register(card)`** — `Broker.register` populates `AgentRegistry` so
  `team ps`/`team send` can resolve the roster (panes engines never self-register).
- **`runtime.spawn`** — `PanesRuntime.spawn` (next diagram detail) or
  `ServersRuntime.spawn`. Launch command:
  `TEAM_AGENT_ID=<id> TEAM_SOCKET=<socket> <env> <command> <args>`.
- **Stay alive** — `teamUp` writes the pidfile and returns WITHOUT exiting; the
  socket server keeps the event loop open so later `team send`/`team inbox` reach
  the broker. `team down` signals the pid from the pidfile.

## `PanesRuntime.placePane` (tmux topology)

```mermaid
flowchart TD
  A["spawn(agent)"] --> B{"window already opened?"}
  B -- yes --> C["split-window -t <winId> -P -F #{pane_id}"]
  C --> D["select-layout -t <winId> <layout|even-horizontal>"]
  D --> P["return new pane id"]
  B -- no --> E{"session created yet?"}
  E -- no --> F["new-session -d -s <team> -n <window> -P -F '#{window_id} #{pane_id}'"]
  E -- yes --> G["new-window -t <team> -n <window> -P -F '#{window_id} #{pane_id}'"]
  F --> H["store winId; return pane id"]
  G --> H
```

`windowName = agent.window ?? agent.id`. Agents sharing a `window` value become
panes in one window (split + re-layout); pane order follows agent order. Pane ids
are captured (`#{pane_id}`) and stored so `wake` targets the stable id even after
tmux automatic-rename. Source: `src/runtime/panes.ts` (`spawn`, `placePane`,
`typeAndSubmit`).

## Teardown

`team down` → `teamDown` (`lifecycle.ts`): read pid from pidfile, `proc.kill(pid,
SIGTERM)`, remove pidfile + socket. The signalled process's shutdown handler runs
`bootstrapper.down()` → `runtime.teardown()` (`kill-session <team>`), then
`daemon.stop()`, then cleanup.
