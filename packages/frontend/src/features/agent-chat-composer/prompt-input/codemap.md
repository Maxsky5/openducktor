# packages/frontend/src/features/agent-chat-composer/prompt-input/

## Responsibility

Reusable prompt-input affordances for agent chat composers: slash command catalogs, reusable prompt command merging, runtime prompt-input capability checks, and file search query access.

## Design/Patterns

Keep this folder about composer input helpers only. Preserve fail-fast repo-vs-active-session runtime boundaries and avoid fallback paths that hide an unready runtime connection.

## Flow

Page adapters combine prompt catalogs, runtime capability checks, reusable prompts, and file search access into composer input state.

## Integration

Uses TanStack Query option builders from `state/queries` and is orchestrated by page-level composer adapters.
