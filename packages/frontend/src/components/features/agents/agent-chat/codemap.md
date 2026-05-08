# packages/frontend/src/components/features/agents/agent-chat/

## Responsibility

Reusable agent chat surface: transcript thread, markdown/code-fence rendering, composer, tool cards, approval/question actions, session todos, runtime attachment retry, document preview/copy controls, and transcript dialog hosting.

## Design/Patterns

Model/view split with local hooks and extracted helpers for thread windowing, composer state, attachments, markdown rendering, and message formatting.

## Data & Control Flow

Runtime transcript state becomes the `AgentChatModel`; user input, approval replies, and question answers flow back through callback props and transcript actions.

## Integration Points

`use-agent-chat-surface-model`, `agent-chat-thread-windowing`, `agent-chat-composer-*`, `agent-session-question-*`, `agent-chat-attachments*`, `agent-chat-message-card-*`, `agent-chat-markdown-renderer`, `pages/agents`, and `TaskDetailsSheet`.
