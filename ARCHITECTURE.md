# agent-bootstrap — Architecture

## Overview

**agent-bootstrap** is a config-driven TypeScript framework that bootstraps a
multi-agent team of CLI coding agents (Claude Code, Codex, etc.) from a single
`team.yaml`. One file declares the agents, their roles, worktrees, capabilities,
and message subscriptions; one `team up` brings the whole team online; the agents
coordinate by passing messages through a **local broker** that speaks
**A2A (agent-to-agent) semantics** — agent cards, typed messages with parts, and
a task state machine.

The framework is built around a small set of **seams** (interfaces) so the same
broker/routing/persistence core works under two runtimes:

- **panes** (v1, default) — each agent is a **tmux pane** running its CLI; the
  broker delivers by nudging the pane with `send-keys` and the agent pulls its
  inbox over a unix socket.
- **servers** (v2) — each agent is a **`kind:"server"` engine process** hosting
  its own **A2A-over-HTTP** endpoint; the broker pushes messages to each agent's
  webhook (or calls `message/send` over JSON-RPC), all throttled by a shared
  fleet rate-limiter.

Everything (config schema, A2A model, broker, CLI, persistence) is shared between
the two; only the `Runtime` and broker `Transport` implementations differ, and
they are chosen in one place (`src/compose.ts`).

## Entry point & control flow

```
bin/team (bash)  →  node --import tsx bin/team.ts  →  verb dispatch
```

- **`bin/team`** is a tiny bash wrapper that execs `node --import tsx bin/team.ts`.
  It is kept separate from `bin/team.ts` so the `.ts` file stays shebang-free and
  importable as a module (a shebang breaks tsx's parser).
- **`bin/team.ts`** dispatches verbs. Setup and lifecycle verbs are handled
  *before* commander, because they run their own composition roots:
  - **`doctor`** → `runDoctorCommand()` (compose.ts); prints the report, exits
    `0`/`1` on `report.ok`.
  - **`init`** → `runInitCommand({ yes, out }, confirmUp)` (compose.ts); parses
    `--yes` and `--out <path>`, writes the config, exits.
  - **`up` / `down`** → loads `team.yaml` (env `TEAM_CONFIG`, default `team.yaml`),
    reads each referenced role template from `templates/`, calls `buildContainer`,
    then `teamUp(...)` / `teamDown(...)` from `client/lifecycle.ts`. `up` does
    **not** `process.exit` — the socket server holds the event loop open so the
    broker stays reachable for later `send`/`inbox`.
  - All other verbs (**`send` / `inbox` / `ps`**) fall through to the commander
    program built by `buildProgram(client, agentId, print)` in `client/cli.ts`,
    driven by a `BrokerClient` over a `NodeSocketClient`. The agent id comes from
    `TEAM_AGENT_ID` (default `operator`) and the socket from `TEAM_SOCKET`
    (default `.team/broker.sock`).

**`src/compose.ts` is the single composition root.** It is the only module that
constructs concrete classes. `buildContainer(cfg, templates)` wires the broker,
store, registry, router, feed, daemon, transport, runtime, and bootstrapper —
branching on `cfg.runtime` to pick the panes vs servers transport/runtime pair.
`runDoctorCommand()` and `runInitCommand()` compose the setup flows (which, engine
registry, doctor, wizard, prompter).

## Architecture & seams

The codebase follows strict **constructor dependency injection**: every class
takes its collaborators as **interface-typed** constructor params and never
`new`s a collaborator internally. Concrete implementations (`Node*`, `System*`,
`Uuid*`, real classes) are built **only** in `compose.ts`. Units test headlessly
against fakes injected in their place.

Key seams:

- **`Runtime`** (`runtime/runtime.ts`) — *how agents are hosted and notified*:
  `spawn` / `wake` / `teardown`. Implementations: `PanesRuntime` (tmux) and
  `ServersRuntime` (engine processes + A2A link). Selected by `selectRuntime`.
- **broker `Transport`** (`broker/transport.ts`) — *how a routed message reaches
  a recipient*: `deliver` / `listen` / `close`. Implementations: `SocketTransport`
  (panes: nudge the pane via the runtime) and `A2ATransport` (servers: push to
  webhook / `message/send`, through the `FleetScheduler`).
- **`EngineProfile` registry** (`engines/`) — maps an engine name to its launch
  command, role file, kind, args, env. Built-ins plus per-config overrides.
- **Ports layer** (`ports/`) — every side effect lives behind a narrow interface:
  clock, ids, fs, tmux, git, http (server+client), process spawner, sleeper,
  which/command-locator, prompter, socket transport.

### Message flow — panes mode

```
team send (CLI)
   │  unix socket (JSON line)
   ▼
NodeSocketServer ─▶ BrokerDaemon ─▶ Broker.send
                                      │  Router.resolve(to,type) → recipient ids
                                      │  JsonlStore.append + FeedRenderer.append
                                      │  enqueue to in-memory inbox per recipient
                                      ▼
                              SocketTransport.deliver(card,msg)
                                      │
                                      ▼
                              PanesRuntime.wake → tmux send-keys hint
                                      ▼
                       agent pane runs `team inbox` → inbox/read pulls messages
```

### Message flow — servers mode

```
team send / broker
   │
   ▼
BrokerDaemon ─▶ Broker.send
                  │  Router.resolve → recipient ids
                  │  JsonlStore.append + FeedRenderer.append + inbox enqueue
                  ▼
            A2ATransport.deliver(card,msg)
                  │  FleetScheduler.run(agentId, …)   (concurrency + token bucket + 429 backoff)
                  ▼
            WebhookSender.push → POST http://host:port/webhook   (bearer auth)
              └─ (fallback) A2AClient.sendMessage → JSON-RPC POST /a2a
                  ▼
            agent's A2AServer handles the message
```

Note the broker is **mediated** in both modes — there is no direct
agent-to-agent A2A in v1/v2 (recipients still route through the broker). Direct
A2A and mixed/multi-host runtimes are deferred to v3.

## Folder-by-folder

- **`src/a2a/`** — the A2A data model (`types.ts`) and the A2A-over-HTTP wire
  layer (`http/`): JSON-RPC types, server, client, SSE streaming, bearer auth,
  and HTTP-429 rate-limit translation.
- **`src/config/`** — the Zod `team.yaml` schema and the YAML loader.
- **`src/ports/`** — side-effect seams + their Node-backed concretes (and a few
  test fakes like `FakeWhich`, `ScriptedPrompter`).
- **`src/broker/`** — the message broker core: persistence (`store`), directory
  (`registry`), routing (`router`), the `Broker` itself, the wire protocol, the
  human feed, the socket daemon, the two transports, and the task state machine.
- **`src/client/`** — the operator/agent side: `BrokerClient` RPC, the commander
  CLI, and the `team up`/`down` lifecycle.
- **`src/runtime/`** — the `Runtime` seam, `PanesRuntime`, `selectRuntime`, and
  the `servers/` runtime (process-backed agents + the `FleetScheduler`).
- **`src/bootstrap/`** — turning config into a running team: topology plan, role
  cards + role-file rendering, worktree creation, the `doctor` probe, and the
  `Bootstrapper` orchestrator.
- **`src/engines/`** — the `EngineProfile` model and the built-in/overridable
  engine registry.
- **`src/cli/`** — the interactive `init` wizard and the `doctor` report
  formatter.
- **`src/compose.ts`** — the single composition root.

## File-by-file reference

### `src/a2a/types.ts`
The A2A data model and small type guards. No I/O.
- `type Cli = "claude" | "codex"` — engine CLI discriminator carried on cards.
- `interface AgentCard` — `{ id, role, cli, engine, capabilities[], skills[], workdir, subscribes[] }`; an agent's directory entry.
- `type Part` — a message part: `{kind:"text",text}` | `{kind:"data",data}` | `{kind:"file",path}`.
- `interface Message` — `{ id, task?, from, to, type, parts[], ts }`.
- `type TaskState` — `submitted | working | input-required | completed | failed | canceled`.
- `interface Task` — `{ id, title, state, owner, history[], artifacts[] }`.
- `const DEFAULT_MESSAGE_TYPES` — default message-type vocabulary (review_request, review_comment, approval, escalation, ruling, status, task_assignment, note).
- `function isPart(p): p is Part` — runtime guard for a part.
- `function isMessage(m): m is Message` — runtime guard for a message (used by the store and A2A server).

### `src/a2a/index.ts`
Barrel re-exporting `./types.ts`.

### `src/a2a/http/types.ts`
A2A-over-HTTP wire contract (paths, JSON-RPC envelope, error codes).
- `const A2A_PATHS` — `{ agentCard:"/.well-known/agent-card.json", rpc:"/a2a", rpcStream:"/a2a/stream" }`.
- `const A2A_METHOD_MESSAGE_SEND = "message/send"`, `const A2A_METHOD_MESSAGE_STREAM = "message/stream"`.
- `interface JsonRpcRequest<P>` / `JsonRpcSuccess<R>` / `JsonRpcErrorResponse` / `type JsonRpcResponse<R>` — JSON-RPC 2.0 envelope types.
- `const JSON_RPC_ERRORS` — standard codes plus `unauthorized: -32001`.
- `interface MessageSendParams` / `MessageSendResult` — `{ message }` in/out.

### `src/a2a/http/server.ts`
Exposes one agent over A2A-over-HTTP via an injected `HttpServer`.
- `interface A2ARequestHandler` — app logic: `onMessageSend(params)`.
- `class A2AServer` — ctor `(http, card, handler, auth?)`; `register()` mounts the card route + JSON-RPC `/a2a` route (validates the envelope, enforces bearer auth when configured, validates `params.message`); `listen(port)` / `close()`.

### `src/a2a/http/client.ts`
Client for one remote agent's A2A endpoint via an injected `HttpClient`.
- `class A2AClient` — ctor `(http, baseUrl, token?)`; `fetchAgentCard()`; `sendMessage(message)` (JSON-RPC POST, attaches bearer, throws on 429 and on JSON-RPC error).

### `src/a2a/http/stream.ts`
Server-Sent-Events flavour of `message/stream`, plus SSE codec helpers.
- `const SSE_CONTENT_TYPE = "text/event-stream"`.
- `interface StreamEvent` — `{ event?, data }`.
- `function encodeSseFrame(ev)` / `encodeSseStream(events)` / `parseSseFrames(body)` — SSE codec.
- `interface A2AStreamHandler` — `onMessageStream(message): StreamEvent[]`.
- `function registerStreamRoute(http, handler, auth?)` — mount the SSE route (auth-gated).
- `function streamMessage(http, baseUrl, message, token?)` — client: POST and parse the SSE sequence.

### `src/a2a/http/auth.ts`
Per-agent bearer tokens (localhost trust scope).
- `interface AuthProvider` — `issueToken(agentId)` / `validate(token)`.
- `function bearerToken(headers)` / `bearerHeader(token)` — extract / build the Authorization header.
- `type AuthResult` + `function authorize(headers, auth)` — validate the presented bearer.
- `class BrokerAuthProvider` — ctor `(ids)`; in-memory token↔agent store.

### `src/a2a/http/ratelimit.ts`
Translate an HTTP 429 into a thrown signal the scheduler understands (no upward dependency on the runtime).
- `class HttpRateLimitError` — `status=429`, optional `retryAfterMs`.
- `function retryAfterMsOf(headers?)` — parse `Retry-After` (seconds→ms).
- `function throwIfRateLimited(res)` — throw on a 429 response; no-op otherwise.

### `src/a2a/http/index.ts`
Barrel re-exporting `types`, `server`, `client`, `stream`. (Note: `auth` and `ratelimit` are imported directly where needed, not via this barrel.)

### `src/config/schema.ts`
The Zod `team.yaml` schema and inferred types.
- `const TeamConfigSchema` — validates the whole config; defaults `runtime:"panes"`; rejects duplicate agent ids via `superRefine`. Agents transform `engine` to default from `cli`.
- `type TeamConfig = z.infer<…>` and `type AgentConfig = TeamConfig["agents"][number]`.

### `src/config/loader.ts`
- `function loadConfig(path): TeamConfig` — read+parse YAML, `safeParse` against the schema, throw a descriptive error on failure.

### `src/config/index.ts`
Barrel: re-exports the schema/types and `loadConfig`.

### `src/ports/clock.ts`
- `interface Clock` — `now()` / `isoNow()`.
- `class SystemClock` — real clock.

### `src/ports/ids.ts`
- `interface IdGenerator` — `next(prefix?)`.
- `class UuidGenerator` — `${prefix}_${randomUUID()}`.

### `src/ports/fs.ts`
- `interface FileSystem` — `append/read/write/exists/remove` (write/append auto-create dirs).
- `class NodeFileSystem` — Node `fs` impl.

### `src/ports/tmux.ts`
- `interface TmuxCommands` — `run(args)`.
- `class NodeTmux` — `execFileSync("tmux", …)`.

### `src/ports/git.ts`
- `interface GitCommands` — `run(args, cwd?)`.
- `class NodeGit` — `execFileSync("git", …)`.

### `src/ports/http.ts`
HTTP server+client seams plus Node concretes.
- `interface HttpRequest` / `HttpResponse` / `type HttpHandler`.
- `interface HttpServer` — `route/listen/close`.
- `interface HttpClient` — `request(url, init)`.
- `class NodeHttpServer` — `node:http` server with method+path routing.
- `class NodeHttpClient` — `fetch`-backed client.

### `src/ports/process.ts`
- `interface ProcessHandle` — `kill()` (SIGTERM, resolves on exit).
- `interface ProcessSpawner` — `spawn(command, opts)`.
- `class NodeProcessSpawner` — `child_process.spawn` with merged env, `stdio:"inherit"`.

### `src/ports/sleeper.ts`
- `interface Sleeper` — `sleep(ms)`.
- `class RealSleeper` — `setTimeout`-backed.

### `src/ports/which.ts`
- `interface CommandLocator` — `has(command)`.
- `class NodeWhich` — PATH probe; rejects non-bare names (no shell, no metacharacters).
- `class FakeWhich` — test double over a `Set`.

### `src/ports/prompter.ts`
- `interface Prompter` — `ask/select/confirm`.
- `class NodePrompter` — readline-backed (has `close()`).
- `class ScriptedPrompter` — replays a queued answer list (headless `--yes`/tests).

### `src/ports/transport.ts`
Unix-socket seams + concretes (newline-delimited JSON).
- `interface SocketServer` — `listen(path, onMessage)` / `close`.
- `interface SocketClient` — `request(path, msg)`.
- `class NodeSocketServer` / `class NodeSocketClient` — `node:net` impls.

### `src/broker/store.ts`
- `interface MessageStore` — `append(m)` / `replay()`.
- `class JsonlStore` — append-only JSONL log; `replay` filters via `isMessage`.

### `src/broker/registry.ts`
- `interface AgentDirectory` — `register/has/get/all`.
- `class AgentRegistry` — in-memory `Map` of cards.

### `src/broker/router.ts`
- `interface MessageRouter` — `resolve(to, type)`.
- `class Router` — ctor `(registry)`; resolves `to` (agent id | role | capability) + subscribers of `type` to recipient ids; throws if nothing matches.

### `src/broker/broker.ts`
The broker core.
- `interface SendInput` / `interface BrokerDeps` / `interface BrokerDispatch`.
- `class Broker` — ctor `(deps)`; `register`, `agents`, `send` (route → stamp id/ts → store → feed → per-recipient inbox enqueue + `transport.deliver`), `inbox` (drain), `rebuild` (replay log into inboxes, no re-wake/re-append).

### `src/broker/protocol.ts`
The socket wire protocol.
- `type Request` — `agent/register | agent/list | message/send | inbox/read`.
- `type Response` — `{ok:true,result} | {ok:false,error}`.
- `function encode(value)` / `function* decodeLines(buffer)` — line codec.

### `src/broker/feed.ts`
- `interface FeedWriter` — `append(m)`.
- `class FeedRenderer` — ctor `(fs, path)`; appends a Markdown line per message to `.team/feed.md`.

### `src/broker/daemon.ts`
- `class BrokerDaemon` — ctor `(broker, server)`; `start(socketPath)` binds the socket server to the dispatch surface; `stop()`; private `handle` maps protocol methods to `BrokerDispatch`.

### `src/broker/transport.ts`
- `interface Transport` — `deliver/listen/close`.
- `class SocketTransport` — ctor `(runtime)`; v1 transport: `deliver` nudges the recipient's pane via `runtime.wake`; `listen`/`close` are no-ops (the daemon owns inbound).

### `src/broker/a2a-transport.ts`
- `interface A2ASender` — `sendMessage(message)`.
- `interface A2AEndpoints` — `clientFor(recipient)`.
- `interface WebhookSender` — `push(recipient, message)`.
- `class A2ATransport` — ctor `(endpoints, webhook?, scheduler?)`; v2 transport: `deliver` runs through the `Scheduler` (when set), then pushes to the webhook (or falls back to `sendMessage`).

### `src/broker/tasks.ts`
The A2A Task state machine, persisted over the same JSONL log.
- `const TASK_EVENT_TYPE = "task_status"`.
- `class TaskMachine` — ctor `(store, clock, ids)`; `create({title,owner})` → `submitted`; `transition(taskId, to)` (rejects illegal/terminal transitions); `get`/`all`; `rebuild()` replays `task_status` events from the log.

### `src/client/rpc.ts`
- `class BrokerClient` — ctor `(transport, socketPath)`; `send/inbox/list/register` over the socket protocol; maps connect failures to `"broker down — run \`team up\`"`.

### `src/client/cli.ts`
- `interface ClientLike` — the slice the CLI needs.
- `function buildProgram(client, agentId, print)` — commander program with `send --to --type [--task] <body>`, `inbox`, `ps`.

### `src/client/lifecycle.ts`
- `interface DaemonLike` / `BootstrapLike` / `ProcessControl` / `LifecycleDeps`.
- `function teamUp(daemon, bootstrapper, socket, deps)` — start daemon, bootstrap, write pidfile, register a SIGINT/SIGTERM teardown handler; does **not** exit.
- `function teamDown(deps, signal?)` — signal the recorded pid, clear the pidfile; `false` if no pidfile.

### `src/runtime/runtime.ts`
- `interface SpawnCtx` — `{ config, socketPath }`.
- `interface Runtime` — `spawn(agent, ctx)` / `wake(agentId, summary)` / `teardown()`. (Heavily documented as the extension point.)

### `src/runtime/panes.ts`
- `class PanesRuntime` — ctor `(tmux, session, engines)`; `spawn` opens a tmux window and launches the engine command with `TEAM_AGENT_ID`/`TEAM_SOCKET` + profile env/args; `wake` sends a one-line `send-keys` mail hint; `teardown` kills the session.

### `src/runtime/select.ts`
- `function selectRuntime(cfg, tmux, engines, makeServersRuntime)` — `panes` → `PanesRuntime`; `servers` → validate every agent's engine is `kind:"server"` then build via the factory.

### `src/runtime/servers/servers.ts`
- `interface AgentLink` — `register(card)` / `notify(card, summary)`.
- `interface ServersRuntimeDeps` — `{ spawner, engines, link }`.
- `function assertServerEngine(engineName, engines)` — throw unless the engine is `kind:"server"`.
- `class ServersRuntime` — ctor `(deps)`; `spawn` launches the engine process (env `TEAM_AGENT_ID`/`TEAM_BROKER_SOCKET`) and registers its card via the link; `wake` pushes a notify; `teardown` kills every process.

### `src/runtime/servers/scheduler.ts`
- `interface Scheduler` — `run(agentId, call)`.
- `interface FleetSchedulerConfig` — concurrency/bucket/refill + backoff knobs.
- `class RateLimitError` + `function isRateLimited(err)` + (internal) retry-after extraction.
- `class FleetScheduler` — ctor `(deps)`; one fleet-wide gate: FIFO concurrency semaphore + token bucket + exponential backoff on 429 (honoring server `retryAfterMs`). All timing via injected `Clock`/`Sleeper`.

### `src/bootstrap/topology.ts`
- `interface PaneSpec` / `TopologyPlan`.
- `function planTopology(cfg)` — derive the tmux session, per-agent panes (workdir = worktree path or workdir), and extra windows.

### `src/bootstrap/roles.ts`
- `function roleFileName(agent, engines)` — the file the engine auto-reads (e.g. `CLAUDE.md`), from the engine profile.
- `function toCard(a)` — `AgentConfig` → `AgentCard` (workdir = worktree path or workdir).
- `function renderRoleFile(template, a)` — minimal `{{id}}/{{role}}/{{cli}}/{{workdir}}/{{capabilities}}/{{subscribes}}` substitution.

### `src/bootstrap/worktrees.ts`
- `function createWorktrees(cfg, git)` — create a branch+worktree per agent that declares one; idempotent (skips existing/registered/shared paths).

### `src/bootstrap/doctor.ts`
- `interface DoctorInput` / `DoctorReport`.
- `function runDoctor(input)` — probe core tools (`tmux`, `git`, `node`) as blockers + per-engine presence.

### `src/bootstrap/bootstrapper.ts`
- `interface BootstrapDeps` — `{ runtime, git, fs, engines, templates }`.
- `class Bootstrapper` — ctor `(cfg, deps)`; `up(socketPath)` creates worktrees, writes each card to `.team/cards/<id>.json`, renders+writes each role file, then spawns each agent via the runtime; `down()` tears the runtime down.

### `src/engines/profile.ts`
- `type EngineKind = "repl" | "server"`.
- `interface EngineProfile` — `{ name, command, roleFile, kind?, args?, env? }`.

### `src/engines/registry.ts`
- `const BUILTIN_ENGINES` — claude, codex, cursor-agent, opencode, gemini, aider (all `repl`).
- `interface EngineRegistry` — `get/list`.
- `interface EnginesConfig` + `function resolveEngines(config)` — built-ins overlaid by per-config engine overrides.

### `src/engines/index.ts`
Barrel: profile + registry.

### `src/cli/wizard.ts`
- `interface WizardInput` / `WizardConfig`.
- `function runWizard(input)` — interactive: team name, preset shape (solo / lead+writer+reviewer / "lead + N pairs"), engine per agent (offers only installed REPL engines).
- `function writeConfigYaml(path, cfg)` — serialize to YAML and write.

### `src/cli/doctor-cmd.ts`
- `function formatDoctorReport(r)` — render the doctor report as text.

### `src/compose.ts`
The single composition root.
- `function buildContainer(cfg, templates)` — wires the whole system; branches panes vs servers (builds `BrokerAuthProvider` + per-agent tokens + `FleetScheduler` + `A2ATransport` for servers, or `SocketTransport` for panes); returns `{ broker, daemon, bootstrapper, runtime, transport }`.
- `function runDoctorCommand()` — compose+run `doctor`.
- `interface InitOptions` + `function runInitCommand(opts, confirmUp)` — probe availability, run the wizard, validate against the schema, write the config.
- (Internal helpers: `a2aBaseUrl`, `a2aEndpoints`, `a2aWebhook`, `a2aLink` — resolve per-agent URLs/clients/webhooks and the servers-mode broker link.)

## Data model

### A2A types
- **AgentCard** — an agent's directory entry: `id`, `role`, `cli`, `engine`,
  `capabilities[]`, `skills[]`, `workdir`, `subscribes[]`. Built from config by
  `toCard`, registered in the broker, and served at the A2A well-known path.
- **Message** — `id`, optional `task`, `from`, `to`, `type`, `parts[]`, `ts`.
  `to` is resolved by the router (agent id | role | capability); `type` is the
  message vocabulary (review_request, ruling, approval, …).
- **Part** — `text` | `data` | `file`. Messages carry an array of parts.
- **Task** — `id`, `title`, `state`, `owner`, `history[]`, `artifacts[]`.

### Task state machine (`broker/tasks.ts`)
States: `submitted`, `working`, `input-required`, `completed`, `failed`,
`canceled`. Legal transitions:

```
submitted       → working | canceled
working         → input-required | completed | failed | canceled
input-required  → working | canceled
completed       → (terminal)
failed          → (terminal)
canceled        → (terminal)
```

Each create/transition is persisted as a `task_status` message in the JSONL log,
so `rebuild()` reconstructs all task state by replaying the log.

## Config schema (`team.yaml`)

From `config/schema.ts`:

- **top level**: `name` (required), `root` (default `.`), `runtime`
  (`panes` | `servers`, default `panes`), `windows[]`, `messageTypes[]`
  (defaults to `DEFAULT_MESSAGE_TYPES`).
- **`broker`**: `transport` (`unix`), `socket` (default `.team/broker.sock`).
- **`servers`** (servers mode): `host` (default `127.0.0.1`), `basePort`
  (default `41000`; per-agent port = `basePort + index` unless an agent sets
  `port`), `auth` (default `true`), `rateLimit` (`maxConcurrency` 4,
  `bucketCapacity` 8, `refillPerSec` 2).
- **`engines`**: optional map of `name → { command, args?, roleFile, env?, kind }`
  overriding/adding to the built-ins.
- **`agents[]`** (≥1, unique ids): `id`, `role`, `cli` (`claude`|`codex`,
  default `claude`), `engine` (defaults from `cli`), `workdir` (default `.`),
  `worktree { branch, path }`, `template`, `capabilities[]`, `skills[]`,
  `subscribes[]`, `port` (servers override).

## Persistence & rebuild

The broker persists every message as a line of JSON in `.team/messages.jsonl`
(`JsonlStore`). It also renders a human-readable `.team/feed.md` (`FeedRenderer`)
and writes each agent's card to `.team/cards/<id>.json`. Because the log is the
source of truth, both `Broker.rebuild()` (inboxes) and `TaskMachine.rebuild()`
(task state) reconstruct state by replaying the log — no separate database, and
crash recovery is just a replay. The lifecycle records the owning broker pid in
`.team/broker.pid` so `team down` can signal it.

## Testing

Tests run with the Node test runner under tsx:

```
npm test        # node --import tsx --test "tests/**/*.test.ts"
npm run typecheck   # tsc -p tsconfig.json (noEmit, strict)
```

Tests are headless: they inject fakes (`MemoryFs`, `FakeWhich`,
`ScriptedPrompter`, fake HTTP/socket/process/clock layers in `tests/ports/` and
`tests/a2a/http/fakes.ts`) for every port, so unit tests touch no real tmux,
git, sockets, or processes. The `tests/e2e/` suite exercises the real wiring:
config → bootstrap → broker → daemon over real unix sockets (`team.test.ts`,
`up.test.ts`, `lifecycle.test.ts`, `cli-entrypoint.test.ts`, `init.test.ts`) and
servers/A2A-HTTP over loopback (`servers.test.ts`). The e2e tests that need a
real loopback listen **skip rather than fail** when the sandbox blocks it
(`EPERM`/`EACCES`/`EADDRNOTAVAIL`) — see `isSandboxNetError` in
`tests/e2e/servers.test.ts`. With dependencies installed, the full suite is
**149 tests, all passing**.

## Build status

- **v1 — panes runtime** (config + A2A model, headless broker, `team` CLI,
  panes runtime + bootstrap, e2e todo team): shipped.
- **Phase 2 — interactive CLI + engines** (`team doctor`, `team init` wizard,
  the engine registry + profiles): shipped.
- **v2 — servers / A2A-HTTP** (`ServersRuntime`, A2A HTTP server/client, SSE +
  push webhook, bearer auth, `FleetScheduler`, Task state machine): shipped.
- **Current tag: `v2.0.1`**. Test suite: ~149 tests passing.
- **v3 (planned, not built)** —
  `docs/superpowers/plans/2026-06-06-v3-distributed-observability.md`: direct
  agent-to-agent A2A, mixed/multi-host runtimes, a web dashboard, and an
  auth/hardening pass. All of it slots behind the existing seams.
