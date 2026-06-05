# agent-bootstrap — design spec

**Date:** 2026-06-06
**Status:** Approved for planning
**Repo:** `~/Desktop/workspace/AI/agent-bootstrap`

A config-driven framework that bootstraps a multi-agent "team" of CLI coding
agents (Claude / Codex) working in a tmux session and communicating through a
local message broker with **A2A semantics** (Agent Cards, Tasks, Messages,
Parts). One `team.yaml` file replaces all the hand-built boilerplate — tmux
topology, per-agent role files, git worktrees, and the coordination protocol.

---

## 1. Motivation

The `vibe-do-list` project was assembled by hand:

- `start.sh` — a tmux session with hardcoded windows/panes (frontend writer +
  reviewer, backend writer + reviewer, lead, servers, git).
- Three hand-written `CLAUDE.md` role files (lead / FE writer / BE writer).
- `.coord/*.md` files (`REVIEW_QUEUE.md`, `REVIEW_COMMENTS.md`,
  `ESCALATIONS.md`) polled manually by each agent.
- The lead glued everything together with `tmux capture-pane` / `send-keys`.
- Git worktrees + branches created by hand.

Every new multi-agent project re-does all of this from scratch. **agent-bootstrap
turns that boilerplate into generated output from a single declarative config.**

### What it eliminates

| Today (manual) | Becomes (generated from `team.yaml`) |
|---|---|
| `start.sh` with hardcoded windows/panes | tmux topology rendered from config |
| Hand-written `CLAUDE.md` role files | role files rendered from templates + per-agent card |
| `.coord/*.md` polled by hand | typed messages over a local broker |
| lead `capture-pane` / `send-keys` glue | first-class `team` CLI + broker wake-ups |
| manual `git worktree` + branch setup | worktrees/branches created from config |

---

## 2. Goals & non-goals

### Goals (v1)
- A single `team.yaml` fully describes a team and reproduces the `vibe-do-list`
  setup with `team up`.
- A local **message broker** routes typed messages between agents with A2A
  semantics.
- Agents are **watchable, steerable** Claude/Codex REPLs in tmux panes
  (subscription auth, no API key).
- Idle agents are **woken** when mail arrives (no constant polling).
- Worktrees / branches / role files / agent cards are **generated**.
- The runtime is abstracted behind a config flag so a future `servers` runtime
  can be added without touching the broker, client, or config.

### Non-goals (v1, deferred)
- The `servers` runtime (Agent-SDK HTTP servers). Only the interface **seam**
  ships in v1 — no servers implemented.
- A2A **SSE streaming** and **push-webhook** delivery; full Task state machine.
  v1 uses pane wake-ups and lightweight tasks.
- Inter-agent **auth** (local trust model).
- A web dashboard (a read-only `.team/feed.md` mirror suffices).

---

## 3. Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework stack | **TypeScript / Node** | Matches existing world; first-class Agent SDK language for the future `servers` runtime. |
| Config format | **YAML, validated by Zod** | Human-friendly; typed `team.ts` option also supported. |
| Broker transport | **Unix domain socket** (HTTP optional) | No port conflicts; local-only by default. |
| Durability | **append-only JSONL event log** + derived state | Replayable, git-diffable, survives broker restarts. |
| Worktree automation | **opt-in** per agent via `worktree:` key | Not every agent needs an isolated tree. |
| Runtime | **`panes` now, `servers` later** behind one interface | Preserves supervision + subscription auth; future-proofs for real A2A. |
| A2A fidelity | **A2A *semantics*, broker-mediated transport** | CLI REPLs can't host HTTP endpoints; broker plays the A2A server role. |
| CLI verb | **`team`** (configurable) | Short; agents type it constantly. |

### Why "A2A semantics, broker-mediated transport"

Google's A2A protocol assumes **every agent is an addressable HTTP server** that
publishes an Agent Card at `/.well-known/agent-card.json` and accepts JSON-RPC
`message/send` (with SSE streaming + push-notification webhooks for long tasks).
Interactive `claude` / `codex` CLIs in tmux panes are **TTY REPLs, not servers** —
they cannot host endpoints or hold open SSE connections.

So we **borrow A2A's data model** (Agent Card, Task, Message, Part, Artifact) and
**replace its transport**: the local broker *is* the A2A server, each CLI agent is
a thin client, and the broker's "wake the pane" nudge plays the role A2A's
push-notification webhook plays for long-running peers. A future `servers`
runtime can upgrade to literal HTTP A2A without changing the data model.

---

## 4. Architecture

Five units, each with one clear purpose and an independently testable interface,
plus a bootstrapper that wires them together.

### 4.1 Config + schema (`src/config`)
Loads and validates `team.yaml` (Zod). The single source of truth: session name,
root, runtime, agents (id, role, cli, workdir/worktree, capability card,
subscriptions, role-template), tmux topology (extra windows), broker settings,
and the message-type vocabulary. Produces a typed, validated `TeamConfig`.

### 4.2 A2A data model (`src/a2a`)
Types borrowed from Google A2A so the vocabulary is standards-aligned:

```ts
type AgentCard = {
  id: string                 // "fe-writer"
  role: string               // "writer" | "reviewer" | "lead" | custom
  cli: "claude" | "codex"
  capabilities: string[]     // ["frontend","react","tailwind"]
  skills: string[]
  workdir: string
  subscribes: string[]       // message types delivered to this agent
}

type Part =
  | { kind: "text"; text: string }
  | { kind: "data"; data: unknown }     // structured JSON
  | { kind: "file"; path: string }

type Message = {
  id: string
  task?: string
  from: string
  to: string                 // agent id | role | capability
  type: string               // review_request | review_comment | approval | ...
  parts: Part[]
  ts: string                 // ISO8601
}

type Task = {
  id: string
  title: string
  state: "submitted" | "working" | "input-required"
       | "completed" | "failed" | "canceled"
  owner: string
  history: Message[]
  artifacts: Part[]
}
```

**Default message-type vocabulary** (configurable per team):
`review_request, review_comment, approval, escalation, ruling, status,
task_assignment, note`.

Task lifecycle is kept **lightweight** in v1 (ids + state transitions); the full
A2A state machine + streaming is deferred to the `servers` runtime.

### 4.3 Broker (`src/broker`, the `teamd` daemon)
A long-running router listening on the Unix socket. Responsibilities:

- **Registry** — agents register via their Agent Card on startup.
- **Routing** — resolve `to` = agent id, **or** role, **or** capability /
  subscription; fan-out for role/capability targets.
- **Durability** — append every message to `.team/messages.jsonl`; derive inbox
  and task state from the log. Restartable: rebuilds state by replaying the log.
- **Delivery / wake** — on delivery to an idle agent, fire the runtime's wake
  strategy (the A2A "push notification" analog).
- **Human mirror** — render a read-only `.team/feed.md` so the operator keeps the
  glanceable view the `.coord/*.md` files used to provide.

A2A-flavored methods: `agent/register`, `agent/list`, `message/send`,
`inbox/read`, `task/new`, `task/get`, `task/update`.

### 4.4 Thin client (`src/client`, the `team` CLI)
What agents and the operator run. Agent identity comes from a `TEAM_AGENT_ID`
env var injected per pane; the broker socket path from `TEAM_SOCKET`.

| Command | Purpose |
|---|---|
| `team up` / `team down` | bootstrap / tear down the whole team |
| `team send --to <id\|role\|cap> --type <t> [--task <id>] <body>` | send a message |
| `team inbox` | drain this agent's inbox |
| `team recv --wait` | block until a message arrives |
| `team broadcast --type <t> <body>` | send to all / a role |
| `team task new\|get\|done` | task lifecycle |
| `team ps` / `team cards` | list agents + status |
| `team attach` | attach to the tmux session |

### 4.5 Runtime abstraction (`src/runtime`)
One interface, two implementations:

```ts
interface Runtime {
  spawn(agent: AgentCard, ctx: SpawnCtx): Promise<void>
  wake(agentId: string, summary: string): Promise<void>
  teardown(): Promise<void>
}
```

- **`PanesRuntime`** (v1) — spawns each agent as a tmux pane running its CLI;
  `wake` = `tmux send-keys` a nudge (`▶ mail — run: team inbox`) into the pane.
- **`ServersRuntime`** (v1 stub seam only) — agents as Agent-SDK HTTP servers;
  `wake` = A2A push webhook. Not implemented in v1.

The broker, client, config, and data model are **identical** across runtimes —
only spawning + waking differ.

### 4.6 Bootstrapper (`src/bootstrap`, invoked by `team up`)
The piece that eliminates manual setup. In order:

1. Render the tmux topology from config (windows, splits, placement).
2. Create git worktrees + branches for agents that declare `worktree:`.
3. Render role files (`CLAUDE.md` / `AGENTS.md`) from templates + each agent's
   card (capabilities, the comms/debate protocol, how to use the `team` CLI).
4. Emit machine-readable Agent Cards to `.team/cards/<id>.json`.
5. Inject `TEAM_AGENT_ID` + `TEAM_SOCKET` into each pane's env.
6. Start the broker; wait for readiness.
7. Launch each agent CLI; register agents with the broker.

---

## 5. Data flow (the todo team, re-expressed)

```
FE writer commits
  └─▶ team send --to fe-reviewer --type review_request --task T-12 "<sha> slice 4"
        └─▶ broker: append to messages.jsonl, route by id
              └─▶ PanesRuntime.wake(fe-reviewer)  ──▶ tmux send-keys into pane
                    └─▶ fe-reviewer: team inbox  (drains review_request T-12)
                          ├─▶ team send --to fe-writer --type review_comment ...
                          └─▶ team send --to fe-writer --type approval --task T-12

escalation: team send --to lead --type escalation
  └─▶ lead replies: team send --to <writer> --type ruling
```

The `.coord/*.md` conventions survive as **typed messages**; `.team/feed.md` is
the human-readable mirror.

---

## 6. Layout

```
agent-bootstrap/                # the framework (this repo)
  bin/team                      # CLI entry
  src/
    config/                     # schema + loader (Zod)
    a2a/                        # AgentCard, Task, Message, Part types
    broker/                     # router, JSONL store, wake dispatch
    client/                     # `team` CLI
    runtime/                    # PanesRuntime | ServersRuntime (stub)
    bootstrap/                  # tmux topology, worktrees, role+card rendering
  templates/                    # writer / reviewer / lead / custom role files
  docs/superpowers/specs/       # this spec

# dropped into a target project:
team.yaml
.team/
  cards/<id>.json
  messages.jsonl
  tasks.json
  broker.sock
  feed.md
```

---

## 7. Example `team.yaml` (reproduces the todo team)

```yaml
name: todo
root: .
runtime: panes
broker: { transport: unix, socket: .team/broker.sock }
agents:
  - { id: lead, role: lead, cli: claude, workdir: ., template: lead }
  - id: fe-writer
    role: writer
    cli: claude
    worktree: { branch: feat/frontend, path: frontend }
    template: writer
    capabilities: [frontend, react, tailwind]
    subscribes: [review_comment, ruling]
  - id: fe-reviewer
    role: reviewer
    cli: codex
    workdir: frontend
    subscribes: [review_request]
  - id: be-writer
    role: writer
    cli: claude
    worktree: { branch: feat/backend, path: backend }
    capabilities: [backend, hono]
    subscribes: [review_comment, ruling]
  - id: be-reviewer
    role: reviewer
    cli: codex
    workdir: backend
    subscribes: [review_request]
windows: [servers, git]         # extra non-agent windows
```

`team up` reads that and stands up the entire session — worktrees, role files,
broker, panes, and wiring — that `vibe-do-list` built by hand.

---

## 8. Error handling & edge cases

- **Broker not running** when a `team` command is issued → client prints a clear
  "broker down — run `team up`" and exits non-zero.
- **Broker restart** → state rebuilt by replaying `messages.jsonl`; no lost mail.
- **Wake into a busy pane** → send-keys delivers a one-line nudge; the message is
  durable in the inbox regardless of whether the agent reads it immediately.
- **Unknown `to` target** (no matching id/role/capability) → message rejected
  with an error; not silently dropped.
- **Worktree path already exists / branch checked out elsewhere** → bootstrapper
  detects and either reuses or fails loudly with guidance (no force-clobber).
- **Duplicate `team up`** → detect existing session/broker and attach instead of
  double-spawning (mirrors current `start.sh` behavior).

---

## 9. Testing strategy

- **Config**: schema validation unit tests (valid/invalid `team.yaml`).
- **A2A model**: type/serialization round-trip tests.
- **Broker**: routing (id/role/capability), JSONL append + replay-rebuild,
  inbox drain semantics — tested headless without tmux.
- **Runtime**: `PanesRuntime` behind a tmux-command seam so wake/spawn can be
  asserted without a real tmux server; one live smoke test under tmux.
- **Bootstrap**: render-to-string tests for tmux topology + role files + cards;
  worktree creation against a throwaway git repo.
- **End-to-end**: `team up` on the example config in a temp project, assert
  session/panes/broker/cards exist, send a message, assert delivery + wake.

---

## 10. Milestones

1. **Config + A2A model** — schema, types, loader.
2. **Broker** — socket server, routing, JSONL store, inbox/task methods (headless).
3. **Client** — `team` CLI talking to the broker (`send`/`inbox`/`ps`/`task`).
4. **Panes runtime + bootstrap** — `team up`/`down`, tmux topology, worktrees,
   role/card rendering, wake-ups.
5. **End-to-end** — reproduce the todo team from `team.yaml`; smoke test.
6. **Servers seam** — the `Runtime` interface + `ServersRuntime` stub (no impl).
