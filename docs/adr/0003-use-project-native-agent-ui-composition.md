---
status: accepted
date: 2026-02-18
---

# Use Project-Native Agent UI Composition

OpenDucktor's agent surfaces are workflow tools, not generic chat widgets: they combine role-specific launch controls, permission and question handling, task documents, runtime status, tool timelines, and host actions. We will keep the agent UI built from project-native React, shadcn components, Tailwind tokens, and OpenDucktor state/query primitives instead of adopting a third-party assistant UI component system. This keeps workflow semantics in the app while leaving runtime orchestration behind replaceable adapter boundaries.

## Context

At the start of the project, it was reasonable to ask whether OpenDucktor should use an agent UI library instead of building its own Agent Studio surfaces. Since then, the product surface has become more specific:

- task roles map to OpenDucktor workflow states and `odt_*` tools,
- sessions are tied to local runtimes, build worktrees, task documents, and host-managed shell actions,
- permission prompts, structured questions, queued user turns, task documents, todos, git status, and runtime diagnostics all need product-specific rendering and refresh behavior,
- OpenCode and Codex expose different runtime-native event and transport shapes behind the same `AgentEnginePort`.

Those constraints make a generic chat UI kit a poor owner for the primary interaction model.

## Decision

Use project-native composition for Agent Studio:

- React feature components in `packages/frontend`,
- shadcn primitives from `packages/frontend/src/components/ui`,
- Tailwind semantic tokens from the shared frontend theme,
- TanStack Query for stable host/runtime reads,
- OpenDucktor state and operation hooks for live session orchestration,
- `@openducktor/adapters-opencode-sdk` and `@openducktor/adapters-codex-app-server` behind `AgentEnginePort`,
- `@openducktor/host-client` for host commands, task transitions, and runtime control.

Third-party UI libraries may still be used for focused primitives when they fit the local design system, but they must not become the owner of OpenDucktor's agent workflow semantics.

## Considered Options

- Vercel AI SDK UI (`@ai-sdk/react`). Rejected as the primary UI layer because it is a headless message/state layer, not a complete OpenDucktor workflow surface. It may still be useful as a reference for streaming and message-state ideas.
- Assistant-focused component libraries. Rejected as the primary UI layer because they optimize for generic chat assistants, while OpenDucktor needs local runtime lifecycle, task workflow transitions, task documents, and host-command semantics on screen.
- Project-native shadcn + Tailwind composition. Accepted because it matches the existing app shell, keeps UI ownership close to OpenDucktor's workflow model, and preserves runtime replaceability at the adapter boundary.

## Consequences

- Agent Studio UI changes must stay aligned with OpenDucktor contracts and host/runtime ownership, not library-owned chat abstractions.
- New controls should use existing shadcn primitives and semantic theme tokens rather than introducing a parallel visual system.
- Shared agent logic should be extracted into focused local hooks or components only when it removes real duplication across OpenDucktor surfaces.
- Runtime-specific behavior belongs in runtime descriptors, adapters, and host orchestration, not in generic UI component assumptions.
