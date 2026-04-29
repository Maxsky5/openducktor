# packages/frontend/src/lib/

## Responsibility
Shared app utilities for host/runtime detection, query client setup, error formatting, task/status presentation, browser-live transport, shared markdown rendering, shell-bridge client helpers, and desktop-only helpers.

## Design Patterns
Pure functions and thin adapter wrappers. Host/runtime boundaries are isolated here so pages and state code stay mostly declarative.

## Data & Control Flow
Callers use these helpers to resolve runtime mode, create or share the query client, invoke host commands, normalize backend-specific values, and render markdown/transcript content before display.

## Integration Points
`host-client.ts`, `query-client.ts`, `browser-live-client.ts`, `runtime.ts`, `shell-bridge.ts`, `target-branch.ts`, `errors.ts`, `task-*` utilities, `markdown-renderer*.tsx`, and the Tauri/browser shell runtime.
