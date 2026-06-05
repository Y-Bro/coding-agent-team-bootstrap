# HANDOFF — agent-bootstrap

> Context memory for a fresh Claude Code session opened in this folder.
> Read this first, then the spec. The design is **approved**; do **not**
> re-brainstorm — the next step is to build it with a 3-agent team.

---

## Read these first
1. This file.
2. `docs/superpowers/specs/2026-06-06-agent-bootstrap-design.md` — the full,
   approved design spec (architecture, data model, `team.yaml`, milestones).
3. `docs/superpowers/plans/2026-06-06-agent-bootstrap-implementation.md` — the
   bite-sized, TDD implementation plan (6 milestones). **This is what the writer
   executes.**

> Note: `docs/`, role files (`CLAUDE.md`/`AGENTS.md`), and `.coord/` are
> **gitignored / local-only** — `main` tracks only the framework deliverable so
> no role file clobbers `main` on merge.

## Current state
- Repo: `~/Desktop/workspace/AI/agent-bootstrap`, branch `main`.
- Tracked on `main`: `.gitignore`, `HANDOFF.md`, `start.sh`. (Spec, plan, and
  role files are local/gitignored.)
- **Design approved + implementation plan written.** No source code yet — the
  writer starts at Task 1 (project scaffold) toward milestone `m1-config`.
- **Build team is set up** (see below). Launch with `./start.sh`.
- Git commits in this project use `--no-verify` (see Conventions).

## Build team — ready to launch
- `start.sh` opens tmux session `bootstrap`: `lead` (you, repo root, `main`),
  `code` window = writer (Claude) | reviewer (Codex) split, `build` shell.
- Writer + reviewer share the worktree `../agent-bootstrap-build` on branch
  `feat/bootstrap` (lead stays on `main`).
- Role files (local): root `CLAUDE.md` = lead; worktree `CLAUDE.md` = writer
  (Claude auto-reads); worktree `AGENTS.md` = reviewer (Codex auto-reads).
- Protocol: `../agent-bootstrap-build/.coord/{README,REVIEW_QUEUE,REVIEW_COMMENTS,ESCALATIONS}.md`
  (append-only). Reviewer approves with `## APPROVED <ts> <sha>`.
- Branching (spec §11): writer commits small on `feat/bootstrap`; on approval the
  lead merges `--no-ff` to `main`, tags `m<N>-<name>`, merges `main` back.

## What we're building (one paragraph)
A config-driven framework that bootstraps a multi-agent **team** of CLI coding
agents (Claude / Codex) in a tmux session, communicating through a **local
message broker** with **A2A semantics** (Agent Cards, Tasks, Messages, Parts).
One `team.yaml` replaces all the hand-built boilerplate — tmux topology, per-agent
role files, git worktrees, and the coordination protocol. CLI verb: `team`
(e.g. `team up`, `team send`, `team inbox`). It generalizes exactly the setup the
sibling project `~/Desktop/workspace/AI/vibe-do-list` built by hand.

## Decisions locked (full rationale in the spec)
| Decision | Choice |
|---|---|
| Transport model | **A2A *semantics*, broker-mediated** (not literal HTTP A2A) |
| Runtime | **`panes` first** (tmux REPLs), **`servers` seam** stubbed for later |
| Stack | TypeScript / Node |
| Config | YAML, validated by Zod |
| Broker | long-running daemon over a **Unix domain socket**; **append-only JSONL** log |
| Durability | rebuild state by replaying `.team/messages.jsonl` |
| Worktrees | opt-in per agent via `worktree:` |
| Wake | idle pane agents nudged via `tmux send-keys` (A2A push-notification analog) |

### Why these (the conceptual conclusions — don't relitigate)
- **A2A assumes every agent is an HTTP server** publishing an Agent Card and
  accepting JSON-RPC `message/send`. Interactive `claude`/`codex` are **TTY REPLs,
  not servers** — so we keep A2A's *data model* and make the **broker** the A2A
  server; each CLI agent is a thin client.
- **Auth is not the deciding axis.** Both runtimes run keyless on the Claude
  subscription. The real constraint for headless servers is **rate limits**
  (one shared pool; a busy fleet throttles) — hence `panes` first for
  supervision + simplicity, `servers` later behind a clean seam.
- The CLI verb stays short (`team`) because agents type it constantly. The repo
  is named `agent-bootstrap`; bin name is configurable.

## v1 scope boundary
- **In:** config + A2A model, broker (routing + JSONL + inbox/tasks), `team` CLI,
  `PanesRuntime`, bootstrap (tmux topology + worktrees + role/card rendering),
  end-to-end reproduction of the todo team from `team.yaml`.
- **Out (stub/seam only):** `ServersRuntime` (Agent-SDK HTTP servers), A2A SSE
  streaming + push-webhook delivery, full Task state machine, inter-agent auth,
  web dashboard.

---

## NEXT GOAL — build agent-bootstrap with a 3-agent team

Mirror the `vibe-do-list` pattern, scaled to a single TS codebase:

- **lead / orchestrator** (Claude) — owns the spec + milestone acceptance,
  resolves escalations, proposes merge plans, never writes feature code.
- **writer** (Claude) — implements milestone by milestone on a feature branch.
- **reviewer** (Codex) — reviews each milestone, appends findings, approves.

The **design spec is the contract** (the analog of `vibe-do-list`'s `CONTRACT.md`).
The orchestrator owns it; the internal seams between modules (the `Runtime`
interface, broker methods, config schema, A2A types) are the interfaces the
reviewer holds the writer to.

### Recipe (what the orchestrator session should set up)
Copy/adapt these from `~/Desktop/workspace/AI/vibe-do-list`:

1. **Role files** (one per agent):
   - root `CLAUDE.md` → lead/orchestrator role (replaces the pointer CLAUDE.md).
   - writer + reviewer role files (in the writer's worktree / a shared `.coord/`).
   Adapt the stack + rules to this project (TS/Node, Zod, the milestones).
2. **`.coord/` protocol** (append-only): `README.md`, `REVIEW_QUEUE.md`,
   `REVIEW_COMMENTS.md`, `ESCALATIONS.md`. Reviewers end with `## APPROVED <ts> <sha>`.
3. **Worktree + branch** for the writer, e.g. `feat/bootstrap` (the lead stays on
   `main`). Single codebase, so one writer worktree is enough.
4. **Launcher** (a `start.sh` analog): tmux session with lead / writer / reviewer
   panes + a build/test pane. The session name can be `bootstrap`.
5. **Build order** = the spec's milestones:
   1. Config + A2A model  2. Broker (headless)  3. `team` CLI
   4. Panes runtime + bootstrap  5. End-to-end (reproduce todo team)  6. Servers seam.
6. Before coding, the lead (or writer) should produce an implementation plan —
   the natural next step is the `writing-plans` skill against the spec.

### Lovely recursion (later, not now)
Once `team up` works, agent-bootstrap can bootstrap **its own** build team from a
`team.yaml`. For v0 we set the team up by hand (as above), exactly like
`vibe-do-list` did.

---

## Conventions / session preferences (carry these forward)
- **`--no-verify` on every `git commit` / `git push`** — the corporate
  pre-commit hook blocks otherwise; the user has authorized bypassing it.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Conventional commits, small chunks.
- `.coord/` files are **append-only** — never rewrite history; every entry has an
  ISO timestamp; reviewers cite the SHA they reviewed; writers cite "fixed in <sha>".
- **Never auto-merge.** The orchestrator proposes a merge plan and waits for the
  user's confirmation.

## Reference — the pattern template
`~/Desktop/workspace/AI/vibe-do-list` is the working example to copy from:
- `start.sh` — tmux launcher (hardcoded; here you'll adapt it).
- `CLAUDE.md` — lead/orchestrator role file.
- `frontend/CLAUDE.md`, `backend/CLAUDE.md` — writer role files.
- `.coord/` — the append-only debate protocol in action.
- `CONTRACT.md` — the shared-interface analog (here: this project's spec).
