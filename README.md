# agent-bootstrap

**agent-bootstrap** is a config-driven TypeScript framework that spins up a whole
team of CLI coding agents (Claude Code, Codex, and friends) from a single
`team.yaml`. It bootstraps the tmux topology, git worktrees, and per-agent role
files, then lets the agents coordinate by passing typed messages through a local
broker that speaks A2A (agent-to-agent) semantics — agent cards, messages with
parts, and a task state machine.

## Features

- **One file drives the team** — agents, roles, worktrees, capabilities, and
  message subscriptions all live in `team.yaml`.
- **Local A2A broker** — routes messages by agent id, role, capability, or
  subscription; persists everything to a JSONL log; renders a human-readable feed.
- **Two runtimes** — **panes** (each agent in a tmux pane) or **servers** (each
  agent a process hosting an A2A-over-HTTP endpoint), chosen by one config field.
- **Pluggable engines** — built-in profiles for claude, codex, cursor-agent,
  opencode, gemini, aider; add your own without touching code.
- **Strict DI / testable** — every side effect lives behind a port; the whole
  system has a single composition root. ~149 tests, all headless.
- **Crash-safe** — state is rebuilt by replaying the message log.

## Requirements

- **Node ≥ 20**
- **tmux** (for the default `panes` runtime)
- **git** (for worktrees)
- An engine CLI on your `PATH` (optional but needed to actually run agents):
  `claude`, `codex`, `cursor-agent`, `opencode`, `gemini`, or `aider`.

Run `./bin/team doctor` to check what's installed.

## Install

```bash
npm install
```

## Quickstart

```bash
# 1. Check your environment (core tools + which engines are on PATH)
./bin/team doctor

# 2. Generate a team.yaml — interactive wizard...
./bin/team init
#    ...or non-interactive (solo preset, first available engine):
./bin/team init --yes            # optionally: --out path/to/team.yaml

# 3. Bring the team up (starts the broker + spawns the agents)
./bin/team up                    # uses team.yaml; override with TEAM_CONFIG=...

# 4. Coordinate
./bin/team send --to reviewer --type review_request --task t1 "abc123 ready for review"
./bin/team inbox
./bin/team ps

# 5. Tear it down
./bin/team down
```

`team up` stays in the foreground holding the broker socket open. Run `send` /
`inbox` / `ps` from other panes or terminals; stop with `Ctrl-C` or `team down`.

Everything also works through the npm script (no wrapper):

```bash
npm run team -- doctor
npm run team -- up
npm run team -- send --to lead --type status "build green"
```

Useful environment variables for the client verbs:

- `TEAM_AGENT_ID` — the id messages are sent *from* / inbox is read *for*
  (default `operator`).
- `TEAM_SOCKET` — broker socket path (default `.team/broker.sock`).
- `TEAM_CONFIG` — config path for `up`/`down` (default `team.yaml`).

## The `team` CLI

| Verb | Description | Example |
| --- | --- | --- |
| `doctor` | Probe core tools (tmux/git/node) and each engine; exit non-zero on a blocker. | `./bin/team doctor` |
| `init` | Interactive wizard that writes a `team.yaml`. | `./bin/team init` |
| `init --yes [--out <path>]` | Non-interactive: solo preset, first available engine. | `./bin/team init --yes --out team.yaml` |
| `up` | Start the broker daemon and bootstrap the team from config; stays running. | `TEAM_CONFIG=team.yaml ./bin/team up` |
| `down` | Signal the running broker to tear the team down and stop. | `./bin/team down` |
| `send --to <target> --type <type> [--task <id>] <body>` | Send a message; `--to` resolves by agent id, role, or capability. | `./bin/team send --to writer --type ruling "approved"` |
| `inbox` | Drain and print this agent's pending messages (`TEAM_AGENT_ID`). | `TEAM_AGENT_ID=writer ./bin/team inbox` |
| `ps` | List registered agents (`id` and `role`). | `./bin/team ps` |

## `team.yaml` reference

```yaml
name: vibe-do-list          # required
root: .                     # repo root (default ".")
runtime: panes              # "panes" (tmux) or "servers" (A2A HTTP). default "panes"

broker:
  transport: unix           # only "unix" today
  socket: .team/broker.sock # broker socket path

# servers-mode settings (ignored in panes mode; safe defaults for loopback)
servers:
  host: 127.0.0.1
  basePort: 41000           # agent port = basePort + index, unless agent sets `port`
  auth: true                # broker-issued bearer tokens per agent
  rateLimit:                # shared fleet rate limiter (FleetScheduler)
    maxConcurrency: 4
    bucketCapacity: 8
    refillPerSec: 2

# optional: override or add engine profiles (overlaid on the built-ins)
engines:
  my-engine:
    command: my-agent       # binary to launch / PATH probe
    roleFile: AGENTS.md      # file the engine auto-reads for its instructions
    kind: repl               # "repl" (panes) or "server" (servers mode)
    args: ["--flag"]
    env: { FOO: bar }

agents:                      # at least one; ids must be unique
  - id: lead
    role: lead
    cli: claude              # "claude" | "codex" (default "claude")
    # engine: claude         # defaults from `cli` when omitted
    workdir: .
    template: lead           # templates/<name>.md (else templates/<role>.md)
    subscribes: [escalation] # message types this agent should be woken for

  - id: fe-writer
    role: writer
    cli: claude
    worktree: { branch: feat/frontend, path: worktrees/frontend }
    template: writer
    capabilities: [frontend, react, css]
    subscribes: [review_comment, ruling]

  - id: fe-reviewer
    role: reviewer
    cli: codex
    workdir: worktrees/frontend
    template: reviewer
    capabilities: [frontend]
    subscribes: [review_request]
    # port: 41010            # (servers mode) explicit A2A port override

windows: [servers, git]      # extra tmux windows to open (panes mode)
# messageTypes: [...]        # override the default message vocabulary
```

Role files are rendered from `templates/<name>.md` with `{{id}}`, `{{role}}`,
`{{cli}}`, `{{workdir}}`, `{{capabilities}}`, `{{subscribes}}` substitution and
written into each agent's workdir under the engine's role filename (e.g.
`CLAUDE.md`).

## Engines

Built-in engine profiles (name → launch command, role file):

| Engine | Command | Role file | Kind |
| --- | --- | --- | --- |
| `claude` | `claude` | `CLAUDE.md` | repl |
| `codex` | `codex` | `AGENTS.md` | repl |
| `cursor-agent` | `cursor-agent` | `AGENTS.md` | repl |
| `opencode` | `opencode` | `AGENTS.md` | repl |
| `gemini` | `gemini` | `GEMINI.md` | repl |
| `aider` | `aider` | `CONVENTIONS.md` | repl |

Add a custom engine under the `engines:` block in `team.yaml` (see the reference
above) and point an agent at it with `engine: my-engine`. An engine's `kind`
must be `server` to be eligible for the `servers` runtime.

## Runtimes

- **`panes`** (default) — each agent runs as a tmux pane driven by `send-keys`;
  the broker delivers a message by nudging the pane and the agent pulls its inbox
  over the unix socket. Best for interactive, human-in-the-loop use where you
  want to watch the agents work. Needs tmux.
- **`servers`** — each agent is a `kind:"server"` engine process hosting its own
  A2A-over-HTTP endpoint; the broker pushes messages to each agent's webhook
  (JSON-RPC `message/send` fallback), throttled by a fleet-wide rate limiter.
  Best for headless/scaled runs. The `servers` block controls the endpoint host,
  base port, bearer **auth** (on by default), and the shared **rate-limit** pool.

Note: routing is **broker-mediated** in both runtimes — there is no direct
agent-to-agent A2A yet, and multi-host / mixed runtimes are not implemented
(planned for v3).

## Testing

```bash
npm test          # node --import tsx --test "tests/**/*.test.ts"  (~149 tests)
npm run typecheck # tsc -p tsconfig.json (strict, noEmit)
```

Unit tests inject fakes for every port and run with no real tmux/git/sockets.
E2e tests that need a real loopback listen **skip** (rather than fail) when a
sandbox blocks it (`EPERM`/`EACCES`/`EADDRNOTAVAIL`).

## Project status & roadmap

Shipped: **v1** (panes runtime), **Phase 2** (interactive `doctor`/`init` CLI +
engine registry), and **v2** (servers runtime, A2A-over-HTTP server/client, SSE +
push webhooks, bearer auth, fleet scheduler, Task state machine). Current tag:
**`v2.0.1`**.

Planned (**not built**): **v3 — distributed A2A + observability**
(`docs/superpowers/plans/2026-06-06-v3-distributed-observability.md`): direct
agent-to-agent A2A, mixed/multi-host runtimes, a web dashboard, and an
auth/hardening pass — all designed to slot behind the existing seams.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design, seams, data model, and a
file-by-file reference.
