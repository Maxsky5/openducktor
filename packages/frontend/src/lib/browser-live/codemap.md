# apps/desktop/src/lib/browser-live/

## Responsibility
Browser-live transport constants and helpers for the browser app mode.

## Design Patterns
Lightweight constants plus transport helpers; the actual HTTP/SSE client lives alongside this folder and consumes these values.

## Data & Control Flow
Browser-mode host calls and SSE channels use these constants to identify reconnected and warning events.

## Integration Points
`browser-mode.ts`, `browser-live-client.ts`, and browser dev-server/task event subscriptions.
