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
- **Two runtimes, mixable** — **panes** (each agent in a tmux pane) or **servers**
  (each agent a process hosting an A2A-over-HTTP endpoint), chosen by one config
  field — or **mixed per-agent** in a single team, with the broker bridging the
  two transports.
- **Broker-mediated or direct A2A** — messages route through the broker by
  default; in servers mode you can opt into **direct** peer-to-peer A2A delivery
  while the broker stays the registry, durable log, and observer.
- **Multi-host ready** — Agent Cards advertise reachable URLs from config, with a
  discovery seam and opt-in TLS for cross-host A2A.
- **Read-only dashboard** — opt-in HTTP+SSE viewer of the live agent roster,
  message feed, and task states (static vanilla JS, no framework).
- **Hardened auth** — per-agent bearer tokens with optional expiry + rotation.
- **Run from anywhere** — install once, then `team up` from any project directory
  (git repo or not); detach the broker with `team up --detach` to free your
  terminal.
- **Pluggable engines** — built-in profiles for claude, codex, cursor-agent,
  opencode, gemini, aider; add your own without touching code.
- **Strict DI / testable** — every side effect lives behind a port; the whole
  system has a single composition root. 266 tests, all headless.
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
./bin/team up --detach           # ...or run the broker in the background (frees your terminal)

# 4. Coordinate
./bin/team send --to reviewer --type review_request --task t1 "abc123 ready for review"
./bin/team inbox
./bin/team ps

# 5. Tear it down
./bin/team down
```

`team up` stays in the foreground holding the broker socket open. Run `send` /
`inbox` / `ps` from other panes or terminals; stop with `Ctrl-C` or `team down`.
With `--detach`, the broker forks into the background and the command returns
immediately — stop it later with `team down`.

**Run from any directory.** The CLI resolves its own dependencies, so you can put
`bin/team` on your `PATH`, `cd` into *any* project (git repo or not), and run
`team init` / `team up` there — the broker socket, `.team/` artifacts, and agent
workdirs resolve against that project (or `root:` if set), not the framework
clone.

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

## Scaffold a team in any folder

`team init` writes a config; `team new` goes one step further — it scaffolds a
*working* team into the current directory: a `team.yaml` (with `root: .`),
interactive window/pane layout, and one **context file per agent**, all in one
step. Install the CLI once, then run it from anywhere:

```bash
# one-time, from this repo
npm link            # exposes `team` on your PATH

# from ANY folder
cd ~/my-project
team new            # interactive: name, engines, windows/layout; writes team.yaml + context files
team new --yes      # non-interactive solo default
team new --no-guidance   # skip LLM role-guidance generation (wiring-only, no engine spawn)
team new --out path/to/team.yaml
```

For each agent, `team new` writes the context file its engine reads on boot —
named by that engine's role file (`CLAUDE.md` for claude, `AGENTS.md` for
codex/cursor-agent, or a custom engine's `roleFile`). Each file gets a
deterministic **team-wiring footer** (who you are, your teammates, the message
types you receive, and the `team inbox` / `team send` commands). When a generator
engine is available it also drafts role-appropriate guidance above the footer;
if generation is unavailable or fails, the file falls back to wiring-only with a
warning — the scaffold never aborts. Existing context files are never
overwritten (they're skipped with a warning).

Config knobs:

- `scaffold.generator` — which engine drafts role guidance (default `claude`,
  validated against the same engine set as agents). `--no-guidance` skips it
  entirely (no engine spawn).
- Per engine profile, `headlessArgs` — the argv that runs an engine as a one-shot
  prompt (`[...args, ...headlessArgs, prompt]`). Built in for claude (`-p`),
  codex (`exec`), and cursor-agent (`-p`); engines without it degrade to
  wiring-only guidance.

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
root: .                     # base dir for all relative paths (default: config-file dir / cwd)
runtime: panes              # "panes" (tmux) or "servers" (A2A HTTP). default "panes"
delivery: broker            # "broker" (default) or "direct" peer-to-peer A2A (servers only)

broker:
  transport: unix           # only "unix" today
  socket: .team/broker.sock # broker socket path

# servers-mode settings (ignored in panes mode; safe defaults for loopback)
servers:
  host: 127.0.0.1
  basePort: 41000           # agent port = basePort + index, unless agent sets `port`
  auth: true                # broker-issued bearer tokens per agent
  tokenTtlSec: 3600         # (optional) token expiry; omitted = no expiry (v2 behavior)
  secret: ${MY_SECRET}      # (optional) signing secret; omitted = random in-process secret
  rateLimit:                # shared fleet rate limiter (FleetScheduler)
    maxConcurrency: 4
    bucketCapacity: 8
    refillPerSec: 2
  tls:                      # (optional) opt-in TLS for cross-host A2A (paths resolved against root)
    cert: certs/server.pem
    key: certs/server.key
    ca: certs/ca.pem        # optional custom CA

# opt-in read-only observability dashboard (default OFF)
dashboard:
  enabled: false
  port: 41999               # serves agents/feed/tasks over HTTP + live SSE

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
    window: lead             # (panes) agents sharing a window become split panes; default = agent id
    subscribes: [escalation] # message types this agent should be woken for

  - id: fe-writer
    role: writer
    cli: claude
    worktree: { branch: feat/frontend, path: worktrees/frontend }
    template: writer
    window: build            # shares the "build" window with fe-reviewer (two panes)
    capabilities: [frontend, react, css]
    subscribes: [review_comment, ruling]

  - id: fe-reviewer
    role: reviewer
    cli: codex
    workdir: worktrees/frontend
    template: reviewer
    window: build
    capabilities: [frontend]
    subscribes: [review_request]
    # runtime: servers       # (mixed teams) host THIS agent on a specific runtime; default = top-level runtime
    # host: 10.0.0.5         # (multi-host) reachable host this agent's card advertises
    # url: https://box:8443  # (multi-host) full base URL, overrides host+port+scheme
    # port: 41010            # (servers mode) explicit A2A port override

windows: [servers, git]      # extra tmux windows to open (panes mode)
layout:                      # (panes) tmux layout per shared window; default even-horizontal
  build: even-horizontal     # even-horizontal | even-vertical | tiled | main-vertical
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

**Mixed runtimes.** A single team can run some agents on `panes` and others on
`servers` by setting `runtime:` per agent (it falls back to the top-level
`runtime`). The broker bridges the two transports, so a pane agent and a server
agent exchange messages transparently.

**Delivery modes.** Routing is **broker-mediated** by default. In `servers` mode
you can set `delivery: direct` for **peer-to-peer A2A** delivery: the sender
resolves the recipient client-side from published Agent Cards and calls its A2A
endpoint directly, while the broker stays the registry, durable JSONL log, and
observer (so rebuild-from-log still works). `delivery: direct` requires every
agent to run on the `servers` runtime.

**Multi-host.** Agent Cards advertise reachable URLs derived from config
(per-agent `host`/`url`, else `servers.host`/`basePort`); the A2A client targets
those URLs, a `DiscoveryProvider` seam resolves them (static default), and TLS is
opt-in via `servers.tls`.

## Dashboard

Set `dashboard.enabled: true` (default OFF) to serve a **read-only** observability
view from the broker process over HTTP + SSE on `dashboard.port`: the live agent
roster, the message feed, and task states, rendered by a static vanilla-JS client
(no framework, no build step). It is strictly read-only — there are no
send/cancel/control endpoints.

## Testing

```bash
npm test          # node --import tsx --test "tests/**/*.test.ts"  (266 tests)
npm run typecheck # tsc -p tsconfig.json (strict, noEmit)
```

Unit tests inject fakes for every port and run with no real tmux/git/sockets.
E2e tests that need a real loopback listen **skip** (rather than fail) when a
sandbox blocks it (`EPERM`/`EACCES`/`EADDRNOTAVAIL`).

## Project status & roadmap

**v3 is complete.** Shipped to date:

- **v1** — panes runtime (config + A2A model, headless broker, `team` CLI,
  bootstrap, e2e todo team).
- **Phase 2** — interactive `doctor`/`init` CLI + engine registry.
- **v2** — servers runtime, A2A-over-HTTP server/client, SSE + push webhooks,
  bearer auth, fleet scheduler, Task state machine.
- **Run-from-anywhere fixes** (`v2.1.0`–`v2.1.2`) — per-agent tmux window/pane
  layout, `root`-anchored paths, `team up --detach`, launcher that boots from any
  cwd, and `team up` in non-git directories.
- **v3 — distributed A2A + observability** (`v3-m1`…`v3-m6`):
  - `v3-m1` direct agent-to-agent A2A (broker as observer + durable log)
  - `v3-m2` mixed-runtime teams (broker bridges panes ↔ servers transports)
  - `v3-m3` multi-host (config Agent Card URLs, discovery seam, opt-in TLS)
  - `v3-m4` read-only observability dashboard (HTTP + SSE, no framework)
  - `v3-m5` auth hardening (bearer token expiry + rotation)
  - `v3-m6` self-bootstrap dogfood (see [`examples/`](./examples/))

Current tags: `v3-m1`…`v3-m6`. Everything slots behind the existing seams — no
rewrites. See the plan in
`docs/superpowers/plans/2026-06-06-v3-distributed-observability.md`.

The [`examples/agent-bootstrap-team.yaml`](./examples/agent-bootstrap-team.yaml)
config is a **self-bootstrap dogfood**: it reproduces this repo's own build team
(lead + writer + reviewer on the panes runtime).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design, seams, data model, and a
file-by-file reference.
