# packages/frontend/src/lib/

## Responsibility
Shared app utilities for query client setup, error formatting, task/status presentation, launch-action metadata, browser-live transport, markdown helpers, copy-preview helpers, and shell-bridge client helpers.

## Design Patterns
Pure functions and thin adapter wrappers. Host/runtime boundaries are isolated here so pages and state code stay mostly declarative.

## Data & Control Flow
Callers use these helpers to create or share the query client, invoke host commands, normalize backend-specific values, resolve session launch actions, and render markdown/transcript content before display.

## Integration Points
`host-client.ts`, `query-client.ts`, `browser-live-client.ts`, `shell-bridge.ts`, `session-launch-actions.ts`, `target-branch.ts`, `errors.ts`, `task-*` utilities, `markdown-renderer*.tsx`, and `markdown-utils.ts`.
