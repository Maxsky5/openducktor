# packages/frontend/src/features/agent-studio-git/

## Responsibility
Agent Studio git diff state, loading, refresh, polling, and worktree resolution helpers.

## Design Patterns
The root module exposes the public hook and public state contracts. Internals are grouped by the behavior they own:

- `model/`: pure diff batch state, snapshot comparison, and host-status normalization.
- `loading/`: request sequencing, in-flight/queued load tracking, and host query execution.
- `refresh/`: manual refresh, scheduled refresh, refresh execution, and polling policy.
- `test-support/`: shared hook harness and git host fakes for behavior tests.
- `__tests__/`: public `useAgentStudioDiffData` behavior tests.

## Data & Control Flow
`useAgentStudioDiffData` resolves the active request context, delegates load lifecycle to `loading/`, delegates refresh policy to `refresh/`, and returns the active public `DiffDataState`. Host git snapshots are normalized by `model/` before they enter React state.

## Integration Points
Agent Studio right-panel models, build-tools UI, host git operations, and task/worktree queries.
