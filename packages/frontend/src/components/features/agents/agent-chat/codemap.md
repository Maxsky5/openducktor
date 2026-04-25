# packages/frontend/src/components/features/agents/agent-chat/

## Responsibility
Agent Studio chat surface: transcript thread, composer, tool cards, pending permissions/questions, session todos, and transcript dialog hosting.

## Design Patterns
Model/view split with local `use-*` hooks, staging/windowing helpers, and formatter utilities for messages, tool output, and attachments.

## Data & Control Flow
Session state from `state/` and orchestrator hooks becomes an `AgentChatModel`; user input, permissions, and question answers flow back through callback props.

## Integration Points
`pages/agents`, `ApplicationOverlays`, `TaskDetailsSheet`, `hostBridge`/runtime attachment helpers, and the broader Agent Studio shell.
