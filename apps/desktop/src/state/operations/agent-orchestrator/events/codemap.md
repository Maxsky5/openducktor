# apps/desktop/src/state/operations/agent-orchestrator/events/

## Responsibility
Session event assembly and translation for live transcript, lifecycle, tool, and batching events.

## Design Patterns
Event helpers normalize host/browser-live payloads into stable session parts before they hit the session store.

## Data & Control Flow
Incoming stream events are classified, batched, and converted into transcript/tool parts or lifecycle updates on the session snapshot.

## Integration Points
`session-events.ts`, `session-lifecycle.ts`, `session-parts.ts`, `session-tool-parts.ts`, and event batching helpers.
