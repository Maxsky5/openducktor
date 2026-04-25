# packages/frontend/src/components/features/agents/agent-studio-git-panel/

## Responsibility
Agent Studio git/worktree UI: diff lists, commit composer, open-in tooling, force-push/rebase dialogs, and git confirmation flows.

## Design Patterns
The panel is driven by a computed model plus narrow helper components for file diffs, git info headers, and confirmation dialogs.

## Data & Control Flow
Build-tools page models feed diff/worktree state into this panel; actions like open-in, commit, rebase, and force push route back through host-aware callbacks.

## Integration Points
`features/agent-studio-git`, `use-agent-studio-build-tools-read-model`, host open-in commands, task worktree resolution, and right-panel composition.
