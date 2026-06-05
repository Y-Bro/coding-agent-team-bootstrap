#!/bin/bash
# Launch the 3-agent build team for agent-bootstrap.
#
#   lead     (Claude) — repo root, on `main`, owns the spec + milestone acceptance
#   writer   (Claude) — feat/bootstrap worktree, implements milestone by milestone
#   reviewer (Codex)  — same worktree, reviews each milestone, appends to .coord/
#   build    (shell)  — same worktree, for `npm test` / `npm run typecheck`
#
# The writer worktree is a SIBLING dir on branch feat/bootstrap. Role files are
# local (gitignored): lead reads ROOT/CLAUDE.md, writer reads WORKTREE/CLAUDE.md,
# reviewer (Codex) reads WORKTREE/AGENTS.md.

set -euo pipefail

SESSION="bootstrap"
ROOT="$HOME/Desktop/workspace/AI/agent-bootstrap"
WORK="$HOME/Desktop/workspace/AI/agent-bootstrap-build"   # feat/bootstrap worktree

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "session '$SESSION' already exists — attaching."
  tmux attach -t "$SESSION"
  exit 0
fi

if [ ! -d "$WORK" ]; then
  echo "ERROR: writer worktree missing at $WORK"
  echo "Create it first:  git -C \"$ROOT\" worktree add -b feat/bootstrap \"$WORK\" main"
  exit 1
fi

# lead — orchestrator on main
tmux new-session -d -s "$SESSION" -n lead -c "$ROOT"
tmux send-keys -t "$SESSION:lead" "claude" C-m

# code window: writer (Claude) | reviewer (Codex) side by side in the worktree
tmux new-window -t "$SESSION" -n code -c "$WORK"
tmux send-keys -t "$SESSION:code" "claude" C-m
tmux split-window -h -t "$SESSION:code" -c "$WORK"
tmux send-keys -t "$SESSION:code.2" "codex" C-m

# build/test pane in the worktree
tmux new-window -t "$SESSION" -n build -c "$WORK"

tmux select-window -t "$SESSION:lead"
tmux attach -t "$SESSION"
