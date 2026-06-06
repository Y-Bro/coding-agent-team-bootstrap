# Examples

## `agent-bootstrap-team.yaml` — self-hosting (dogfood)

This is the meta team that builds **agent-bootstrap itself**: a `lead` (Claude)
orchestrator, a `writer` (Claude) implementing on a feature worktree, and a
`reviewer` (Codex) — three agents on the **panes** runtime, with the writer and
reviewer sharing one tmux window (split panes) to showcase the configurable
layout.

Bring it up from the repo root:

```sh
TEAM_CONFIG=examples/agent-bootstrap-team.yaml team up
```

That spawns agent-bootstrap's own build team. `tests/e2e/self-bootstrap.test.ts`
proves the config parses under the real schema and plans exactly these three
agents — without launching anything.
