# packages/frontend/src/components/features/agents/agent-chat/

## Responsibility

Reusable agent chat surface: transcript thread, markdown/code-fence rendering, composer, tool cards, approval/question actions, session todos, runtime attachment retry, document preview/copy controls, and transcript dialog hosting.

## Design/Patterns

Model/view split with local `use-*` hooks, staging/windowing helpers, markdown healing utilities, and formatter utilities for messages, tool output, attachments, document previews, and chat message IDs.

## Flow

Runtime transcript state becomes the `AgentChatModel`; user input, approval replies, and question answers flow back through callback props and transcript actions.

## Integration

`features/agent-chat-composer`, `pages/agents`, `ApplicationOverlays`, `TaskDetailsSheet`, runtime attachment helpers, markdown renderer helpers, and agent-session surfaces.
