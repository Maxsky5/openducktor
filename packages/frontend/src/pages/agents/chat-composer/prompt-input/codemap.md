# packages/frontend/src/pages/agents/chat-composer/prompt-input/

## Responsibility
Prompt-input affordances for the Agent Studio chat composer: slash command catalogs, reusable prompt command merging, runtime prompt-input capability checks, and file search query access.

## Design Patterns
Keep this folder about composer input helpers only. Preserve fail-fast repo-vs-active-session runtime boundaries and avoid fallback paths that hide an unready runtime connection.

## Integration Points
Uses TanStack Query option builders from `state/queries` and is orchestrated by `../use-agent-studio-chat-composer.ts`.
