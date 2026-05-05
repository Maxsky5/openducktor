# packages/frontend/src/pages/agents/chat-composer/

## Responsibility

Agent Studio page adapter for reusable agent chat composer state.

## Design/Patterns

Expose the route-facing chat composer hook directly from `use-agent-studio-chat-composer.ts`. Keep reusable composer mechanics in `features/agent-chat-composer/`; this folder only adapts Agent Studio route state to that feature.

## Flow

The implementation resolves workspace, role, repo settings, active session, and runtime context, then delegates model selection, reusable prompts, slash commands, prompt input, file search, and context usage to `features/agent-chat-composer/`.

## Integration

Route orchestration imports `useAgentStudioChatComposer` directly. Reusable chat UI uses `components/features/agents/agent-chat` and reusable composer state helpers use `features/agent-chat-composer`.
