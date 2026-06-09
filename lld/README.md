# agent-bootstrap — Low-Level Design (A–Z)

These diagrams describe the whole system end-to-end, in enough detail to
**reimplement it from scratch** (e.g. in Python) from the diagrams + prose alone.
Each section cites the exact `file:function` it documents. Pair this with the
runtime flow logs (`TEAM_TRACE=1`, see `src/obs/trace.ts`) — the logs narrate the
*same* seams these diagrams name, so you can read a diagram and then watch it run.

## What the system is

`agent-bootstrap` stands up a **team of AI coding-agent CLIs** (Claude Code,
Codex, Cursor Agent, …) that collaborate by passing **A2A messages** through a
**broker**. Two runtimes host the agents:

- **panes** (default): each agent is a **tmux pane** running its engine CLI; the
  broker "wakes" an agent by typing a one-line nudge into its pane.
- **servers**: each agent is a **`kind:"server"` engine process** exposing an A2A
  HTTP endpoint; the broker wakes it via an HTTP webhook push.

A **unix-domain socket** carries the client RPC (`team send` / `team inbox` /
`team ps`) to the broker daemon. Everything durable lives in one append-only
**JSONL message log**; broker inbox state, task state, and the dashboard are all
**projections of that log**.

## Architectural spine (read this first)

- **Ports & adapters.** Every side effect (filesystem, tmux, sockets, git,
  child-process spawn, http, clock, uuid, sleep, command-run, stdin prompt) sits
  behind an interface in `src/ports/*`. Concrete `Node*` adapters implement them.
- **Composition root.** `src/compose.ts` is the ONLY place that constructs
  concrete adapters and wires the object graph. Everything else receives its
  collaborators as constructor params (dependency injection).
- **One-way dependencies.** High-level modules (broker, runtime, bootstrap)
  depend on *abstractions* (`Transport`, `Runtime`, `MessageStore`, …), never on
  concretes.
- **Log is the source of truth.** `JsonlStore.append` is the only writer;
  `replay()` rebuilds all derived state (`Broker.rebuild`, `TaskMachine.rebuild`,
  `projectTasks`, sweep policies).

## Index

| # | File | Covers |
|---|------|--------|
| 1 | [01-composition-root.md](01-composition-root.md) | Component/dependency graph — what `compose.ts` wires (ports, broker, runtime, bus, sweep, daemon) |
| 2 | [02-team-up-sequence.md](02-team-up-sequence.md) | `team up` — config load → buildContainer → daemon listen → bootstrap (worktrees, cards, register, never-clobber role files) → spawn at PROJECT ROOT (launch-settle + bootstrap-message inject) → ROLLBACK on failure |
| 3 | [03-message-life.md](03-message-life.md) | A message's life: `send` → router DIRECT vs BROADCAST → record → log/feed/inbox/publish → per-recipient best-effort deliver → wake → peek → ack; `emitInternal` (sweep) + direct observe-first variant |
| 4 | [04-task-projection.md](04-task-projection.md) | Task lifecycle projected from message traffic (TaskProjector + TaskMachine) |
| 5 | [05-sweep.md](05-sweep.md) | Liveness sweep loop: StallPolicy + DeadLetterPolicy |
| 6 | [06-team-new-scaffold.md](06-team-new-scaffold.md) | `team new` — wizard → layout → assemble config → context files (guidance + wiring footer) |
| 7 | [07-servers-a2a-daemon.md](07-servers-a2a-daemon.md) | Servers/A2A runtime, daemon socket protocol, client RPC, scheduler |
| 8 | [08-engine-runtime-selection.md](08-engine-runtime-selection.md) | Engine registry + per-agent runtime selection (panes/servers/composite) |

## Glossary

| Term | Meaning | Where |
|---|---|---|
| **Engine** | a coding-agent CLI an agent runs | `src/engines/registry.ts` (`BUILTIN_ENGINES`) |
| **AgentCard** | the published identity of an agent (id, role, engine, url, subscribes…) | `src/a2a/types.ts`, built by `toCard` |
| **Message** | immutable A2A message `{id,from,to,type,task?,parts,ts}` | `src/a2a/types.ts` |
| **Part** | a message body chunk: `{kind:"text"}` / `{kind:"data"}` / `{kind:"file"}` | `src/a2a/types.ts` |
| **Transport** | how the broker *wakes/delivers* to a recipient (socket vs A2A) | `src/broker/transport.ts`, `a2a-transport.ts` |
| **Runtime** | how an agent is *hosted* (tmux pane vs server process) | `src/runtime/*` |
| **Broker** | routes/records/delivers messages; owns inbox state | `src/broker/broker.ts` |
| **Bus** | in-process observer fan-out of recorded messages | `src/broker/bus.ts` |
| **Task** | A2A task with a state machine, projected from the log | `src/broker/tasks.ts` |
