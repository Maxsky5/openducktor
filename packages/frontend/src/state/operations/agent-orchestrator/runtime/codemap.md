# apps/desktop/src/state/operations/agent-orchestrator/runtime/

## Responsibility
Runtime loading helpers for repo defaults, prompt overrides, task documents, and worktree/runtime attachment.

## Design Patterns
This folder isolates runtime resolution from session orchestration so runtime-specific lookups can be reused across loaders and recovery paths.

## Data & Control Flow
Start-session and session-load code calls these helpers to resolve the correct runtime, document bundle, and worktree before a session launches.

## Integration Points
`runtime.ts`, `host` runtime APIs, and session start/hydration workflows.
