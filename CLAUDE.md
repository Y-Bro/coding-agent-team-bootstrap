# agent-bootstrap

**New session? Read `HANDOFF.md` first**, then
`docs/superpowers/specs/2026-06-06-agent-bootstrap-design.md`.

A config-driven framework that bootstraps a multi-agent team of CLI coding
agents (tmux panes) communicating through a local broker with A2A semantics.

**Current goal:** build this framework using a 3-agent team — a lead
orchestrator, a writer, and a reviewer — mirroring the `vibe-do-list` pattern.
The design is **approved**; do not re-brainstorm. Proceed to planning, then
implementation per the spec's milestones.

**Conventions:** commit with `--no-verify`; trailer
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; conventional commits;
`.coord/` files are append-only; never auto-merge (propose a plan, wait for the user).
