# packages/frontend/src/state/operations/agent-orchestrator/events/

## Responsibility

Session event assembly and translation for live transcript, lifecycle, tool, and batching events.

## Design/Patterns

Small helper modules normalize host/browser-live payloads into stable session parts before they hit the session store.

## Data & Control Flow

Incoming stream events are classified, batched, and converted into transcript/tool parts or lifecycle updates on the session snapshot.

## Integration Points

`session-helpers.ts`, `session-lifecycle.ts`, `session-parts.ts`, `session-tool-parts.ts`, and `session-event-batching.ts`.
