---
status: accepted
date: 2026-02-18
---

# Use project-native Agent UI composition

## Context

Agent Studio is a workflow UI, not a general chat widget. It shows role launch controls, permission requests, questions, task documents, runtime status, tool calls, and host actions.

Its sessions also depend on local runtimes, task worktrees, task metadata, shell actions, queued user turns, todos, Git status, and runtime checks. OpenCode and Codex expose different events and transports behind `AgentEnginePort`. A general chat UI library does not own these product rules.

## Decision

Build Agent Studio from project-owned parts:

- React feature components in `packages/frontend`.
- shadcn components from `packages/frontend/src/components/ui`.
- Tailwind semantic theme tokens.
- TanStack Query for stable host and runtime reads.
- OpenDucktor state and operation hooks for live sessions.
- Runtime adapters behind `AgentEnginePort`.
- `@openducktor/host-client` for host commands, task transitions, and runtime control.

A third-party UI library can provide a small component that fits the local design system. It must not own OpenDucktor workflow rules.

## Options we rejected

- Vercel AI SDK UI as the main UI layer. It manages messages and state, but it does not model the OpenDucktor workflow.
- An assistant UI component library as the main UI layer. General chat controls do not model local runtime and task rules.
- Project-native shadcn and Tailwind composition. We chose this option because it uses the current app shell and keeps runtime code behind adapters.

## Consequences

- Keep Agent Studio UI changes in step with OpenDucktor contracts and host ownership.
- Use current shadcn components and theme tokens.
- Extract a shared hook or component only when two OpenDucktor views have the same rule.
- Put runtime-specific rules in descriptors, adapters, and host orchestration.
