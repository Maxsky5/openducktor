# Agent UI Library Evaluation (V1)

## Question
What is the best React library strategy for OpenBlueprint agent pages (Spec, Planner, Build, QA)?

## Evaluated Options

### 1) Vercel AI SDK UI (`@ai-sdk/react`)
- Strengths:
  - Excellent chat/message state primitives.
  - Strong typing and ecosystem maturity.
- Limitation for this project:
  - It is a headless state layer, not a complete agent workflow component system.
  - OpenBlueprint needs custom orchestration surfaces: permission requests, question replies,
    tool-call timelines, task-document panes, and Tauri/runtime controls.

### 2) Assistant-focused component libraries
- Strengths:
  - Faster bootstrap for generic chat experiences.
- Limitation for this project:
  - OpenBlueprint agent UX is tightly coupled to local OpenCode runtime lifecycle, Beads workflow
    transitions, and Tauri host commands.
  - The app needs custom role/scenario controls and tool-result semantics that are not generic chat UI.

## Decision
Use **project-native shadcn + Tailwind composition** for the agent UI layer and pair it with:
- `@openblueprint/adapters-opencode-sdk` for OpenCode session/event orchestration.
- `@openblueprint/adapters-tauri-host` for task transitions and runtime control.

This keeps the UI fully aligned with OpenBlueprint workflow semantics while preserving replaceable
adapter boundaries (hexagonal architecture).

