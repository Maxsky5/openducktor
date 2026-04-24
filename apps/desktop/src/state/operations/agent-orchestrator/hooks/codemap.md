# apps/desktop/src/state/operations/agent-orchestrator/hooks/

## Responsibility
React hooks that expose orchestrator session state to components and page models.

## Design Patterns
The hook layer wraps external stores and orchestrator services so UI code can subscribe without directly touching the session store internals.

## Data & Control Flow
Session snapshots are read through a hook API and returned to pages/components as live state slices.

## Integration Points
`use-orchestrator-session-state.ts` and the agent-session store/context layer.
