# packages/frontend/src/pages/agents/session-actions/

## Responsibility

Focused Agent Studio session action internals for sending messages, answering agent questions, selecting workflow/session targets, and deriving shared action state.

## Design/Patterns

Keep `use-agent-studio-session-actions.ts` in the parent folder as the public compatibility facade. Put cohesive action-family hooks here when they are specific to Agent Studio page/session orchestration and not reusable feature primitives.

## Flow

The parent facade derives base session state, composes these action hooks, and returns the stable action shape consumed by the Agent Studio orchestration controller and page models.

## Integration

Used by `../use-agent-studio-session-actions.ts`; selection helpers remain in `../use-agent-studio-session-action-helpers.ts`, and session launch behavior remains in `../session-start/`.
