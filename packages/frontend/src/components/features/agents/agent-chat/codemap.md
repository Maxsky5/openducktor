# packages/frontend/src/components/features/agents/agent-chat/

## Responsibility
Agent Studio chat surface: transcript thread, markdown/code-fence rendering, composer, tool cards, permission/question actions, session todos, and transcript dialog hosting.

## Design Patterns
Model/view split with local `use-*` hooks, staging/windowing helpers, markdown healing utilities, and formatter utilities for messages, tool output, attachments, and chat message IDs.

## Data & Control Flow
Runtime transcript state from orchestrator hydration becomes the `AgentChatModel`; user input, permission approvals, and question answers flow back through callback props and transcript actions.

## Integration Points
`pages/agents`, `ApplicationOverlays`, `TaskDetailsSheet`, runtime attachment helpers, markdown renderer helpers, and the broader Agent Studio shell.
