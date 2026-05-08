# packages/frontend/src/state/operations/agent-orchestrator/hooks/

## Responsibility

React hooks that expose orchestrator session state and mutations to components and page models.

## Design/Patterns

The hook layer wraps external stores, listeners, hydration effects, and orchestrator services so UI code can subscribe without directly touching the session-store internals.

## Data & Control Flow

Session snapshots and listener events are read through hook APIs and returned to pages/components as live state slices and mutation callbacks.

## Integration Points

`use-orchestrator-session-state.ts`, `use-agent-session-readers.ts`, `use-agent-session-mutations.ts`, `use-agent-session-listeners.ts`, `use-agent-session-hydration.ts`, `use-runtime-transcript-attachment.ts`, and the agent-session store/context layer.
