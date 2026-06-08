# 3. A message's life — send → deliver → peek → ack

This is the core data path. Trace it live with `TEAM_TRACE=1` — the `[cli]`,
`[rpc]`, `[daemon]`, `[router]`, `[broker]`, `[store]`, `[bus]`, `[panes]` lines
below are the actual seams.

## Full sequence (broker-mediated, panes runtime)

```mermaid
sequenceDiagram
  autonumber
  actor S as sender (team send)
  participant CLI as client/cli.ts
  participant RPC as BrokerClient (rpc.ts)
  participant SOCK as unix socket
  participant DM as BrokerDaemon.handle
  participant BR as Broker.send
  participant RR as Router.resolve
  participant ST as JsonlStore
  participant FD as FeedRenderer
  participant BUS as MemoryBus
  participant TP as TaskProjector
  participant TR as Transport.deliver
  participant RT as Runtime.wake (panes)
  actor R as recipient (team inbox)

  S->>CLI: team send --to worker --type task_assignment --task t1 "..."
  CLI->>RPC: client.send({from,to,type,task,parts})
  RPC->>SOCK: request {method:"message/send", params}
  SOCK->>DM: handle(req)
  DM->>BR: broker.send(params)
  BR->>RR: router.resolve(to,type) → [ids]
  BR->>BR: build Message{id,from,to,type,task,parts,ts}
  BR->>ST: store.append(m)        (durable)
  BR->>FD: feed.append(m)         (human feed.md)
  BR->>BR: inbox[id].push(m) for each recipient
  BR->>BUS: publisher.publish(m)  (fire-and-forget)
  BUS->>TP: handle(m)  → task transitions (see #4)
  BR->>TR: transport.deliver(card, m) for each recipient
  TR->>RT: wake(id, summary)  (socket waker → panes.wake)
  RT->>RT: send-keys -l nudge → sleep → Enter
  DM-->>RPC: {ok:true, result: m}
  RPC-->>CLI: Message
  CLI-->>S: "sent task_assignment → worker"

  Note over R: later, asynchronously
  R->>CLI: team inbox  (TEAM_AGENT_ID=worker)
  CLI->>RPC: peek(worker)
  RPC->>DM: inbox/peek
  DM->>BR: broker.peek(worker) → pending[]
  BR-->>R: messages (printed)
  R->>CLI: (after printing) ack(worker, ids)
  CLI->>RPC: inbox/ack
  RPC->>DM: inbox/ack
  DM->>BR: broker.ack(worker, ids)
  BR->>BR: drop ids from inbox[worker]
  BR->>ST: store.append(inbox_ack{agentId,ids})  (durable watermark)
```

## Routing rules — `Router.resolve(to, type)` (`src/broker/router.ts`)

A `to` value can be an **id**, a **role**, or a **capability**; subscribers of the
message **type** are always added. The recipient set is the **union**:

```mermaid
flowchart LR
  TO["to / type"] --> ID{"registry.has(to)?"} -->|yes| ADD1["+ to"]
  TO --> ROLE{"agent.role == to?"} -->|yes| ADD2["+ agent.id"]
  TO --> CAP{"to in agent.capabilities?"} -->|yes| ADD3["+ agent.id"]
  TO --> SUB{"type in agent.subscribes?"} -->|yes| ADD4["+ agent.id"]
  ADD1 & ADD2 & ADD3 & ADD4 --> SET["dedup set"]
  SET --> E{"empty?"} -->|yes| THROW["throw 'unknown target: to'"]
  E -->|no| OUT["recipient ids"]
```

> **Hub-and-spoke consequence:** `team new` makes the orchestrator (`agents[0]`)
> subscribe to ALL types and everyone else to none. So a message addressed to
> anyone *also* reaches the orchestrator via the subscription rule — which is why
> in the live trace `--to worker` resolved to `[worker, lead]`.

## Persistence + projections — the log is the single source of truth

```mermaid
graph LR
  REC["Broker.record(m, recipients)"] --> APP["store.append(m)"]
  REC --> FEEDW["feed.append(m)"]
  REC --> INBOX["inbox[id].push(m)"]
  REC --> PUB["bus.publish(m)"]
  APP --> LOG[("messages.jsonl")]
  LOG --> RB1["Broker.rebuild() → inboxes (minus acked)"]
  LOG --> RB2["TaskMachine.rebuild() / projectTasks()"]
  LOG --> RB3["sweep policies replay()"]
  LOG --> DASH["dashboard /api/feed,/api/tasks"]
```

- **`record`** (`Broker.record`, private) is the ONLY method that appends a normal
  message, feeds it, fills inboxes, and publishes — both `send` and `observe`
  funnel through it.
- **Delivery vs recording are separate.** `record` fills the in-memory inbox and
  the log (so `peek` works); `transport.deliver` *wakes* the recipient (types a
  nudge / pushes a webhook). A pane agent then runs `team inbox` to pull.
- **peek/ack watermark** (`Broker.peek` / `Broker.ack`): `peek` is
  non-destructive; `ack` drops ids from the inbox AND appends an `inbox_ack`
  record. `rebuild()` replays the log and skips acked ids, so a crash between
  read and processing never loses mail (at-least-once; consumers idempotent).

## Direct (peer-to-peer) variant

When `cfg.delivery === "direct"` (all-servers only), the **sender** delivers
peer-to-peer over A2A via `DirectMessenger` (`src/a2a/direct.ts`) and the broker
is only an **observer**: `Broker.observe(m)` calls `record(m, resolve(...))` to
keep the log/feed/inbox complete but does NOT call `transport.deliver`. Same log,
same projections; the broker is just off the delivery path.

## Message shape (replicate exactly)

```
Message = {
  id: "m_<uuid>",          # IdGenerator.next("m")
  from: str, to: str,       # to may be id|role|capability
  type: str,                # task_assignment | status | review_request | ...
  task?: str,               # optional task id this message concerns
  parts: [Part],            # {kind:"text",text} | {kind:"data",data} | {kind:"file",path}
  ts: ISO8601,              # Clock.isoNow()
}
```
