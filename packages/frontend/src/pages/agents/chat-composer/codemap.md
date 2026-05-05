# packages/frontend/src/pages/agents/chat-composer/

## Responsibility
Agent Studio page adapter for reusable agent chat composer state.

## Design Patterns
Expose the route-facing chat composer hook directly from `use-agent-studio-chat-composer.ts`. Keep reusable composer mechanics in `features/agent-chat-composer/`; this folder should only adapt Agent Studio route state to that feature.

## Data & Control Flow
The implementation resolves workspace, role, repo settings, active session, and runtime context, then delegates model selection, prompt input, file search, slash commands, and context usage to `features/agent-chat-composer/`.

## Integration Points
Route orchestration should import `useAgentStudioChatComposer` directly. Reusable chat UI should use `components/features/agents/agent-chat` and reusable composer state helpers should use `features/agent-chat-composer`.
