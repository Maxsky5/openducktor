# apps/desktop/src/lib/

## Responsibility
Shared app utilities for host/runtime detection, query client setup, error formatting, task/status presentation, browser-live transport, and desktop-only helpers.

## Design Patterns
Pure functions and thin adapter wrappers. Host/runtime boundaries are isolated here so pages and state code stay mostly declarative.

## Data & Control Flow
Callers use these helpers to resolve runtime mode, create or share the query client, invoke host commands, and normalize backend-specific values before rendering.

## Integration Points
`host-client.ts`, `query-client.ts`, `browser-live-client.ts`, `runtime.ts`, `target-branch.ts`, `errors.ts`, `task-*` utilities, and the Tauri/browser shell runtime.
