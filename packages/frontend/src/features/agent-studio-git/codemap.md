# apps/desktop/src/features/agent-studio-git/

## Responsibility
Agent Studio git diff state, polling, refresh, and worktree resolution helpers.

## Design Patterns
Pure diff-data models and hook-driven refresh controllers keep git state derivation separate from the rendered right-panel UI.

## Data & Control Flow
Worktree/runtime snapshots are fetched, normalized into diff data, and refreshed/polled as task or runtime state changes.

## Integration Points
Agent Studio right-panel models, build-tools UI, host git operations, and task/worktree queries.
