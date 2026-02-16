# AGENTS.md

This file is the operating guide for coding agents working in this repository.
Use it as the default source of truth for project-specific implementation rules.

## Purpose

OpenBlueprint is a Bun monorepo for a macOS-first Tauri v2 desktop app that orchestrates AI planning/building workflows with Beads as task source-of-truth.

Goals for agent contributions:

- Preserve clean hexagonal boundaries and replaceable adapters.
- Keep frontend code modular, composable, and easy to evolve.
- Preserve the established product UX decisions (repository-first workflow, modal-driven setup, diagnostics behavior, structured task workflows).

## Monorepo Map

- `apps/desktop`: React + Vite UI and Tauri host integration.
- `apps/desktop/src-tauri`: Rust host application and infra crates.
- `packages/contracts`: Shared runtime schemas and IPC contracts (TS).
- `packages/core`: Core domain services and ports.
- `packages/adapters-opencode-sdk`: `AgentEnginePort` adapter.
- `packages/adapters-tauri-host`: Frontend IPC adapter.

## Architectural Guardrails

### Hexagonal rules

- Keep port definitions in core/domain layers, adapters in infra layers.
- Do not couple UI code directly to infra implementation details when contracts exist.
- When changing data contracts, update `packages/contracts` first, then adapt host/frontend.

### Current replaceable boundaries

- TS port: `AgentEnginePort` in `packages/core/src/ports/agent-engine.ts`
- Rust trait: `TaskStore` in `apps/desktop/src-tauri/crates/host-domain/src/lib.rs`

### Configuration and storage policies (V1)

- Global config path is fixed: `~/.openblueprint/config.json`
- Beads store path is fixed per repo: `~/.openblueprint/beads/<repo-id>/.beads`
- `BEADS_DIR` must be used for Beads CLI execution.
- No user-facing Beads storage path configuration in V1.
- No migration from repo-local `.beads` in V1.

## Frontend Engineering Standards

### Composition and module boundaries

- Prefer composition over monolithic components.
- Keep feature logic in feature folders and expose public APIs via `index.ts` barrels.
- Avoid god components/providers and avoid boolean-prop proliferation.
- Keep side effects and async orchestration in dedicated hooks, not UI leaf components.

### State management

- `apps/desktop/src/state/app-state-provider.tsx` wires contexts and high-level slices.
- Keep domain operations in focused hooks under:
  - `apps/desktop/src/state/lifecycle`
  - `apps/desktop/src/state/operations`
  - `apps/desktop/src/state/tasks`
- Use operation-specific loading flags (`isLoadingTasks`, `isLoadingChecks`, etc.), not generic global busy flags.

### Types and constants

- Centralize frontend shared types under `apps/desktop/src/types`.
- Prefer constants modules (feature-level `constants.ts`) over inline magic strings/numbers.
- Reuse helpers/utilities instead of duplicating transform logic in components.

### UI system

- Use shadcn-based components in `apps/desktop/src/components/ui`.
- Use Tailwind v4 utilities and existing design language in `apps/desktop/src/styles.css`.
- Avoid native browser-styled controls when a project UI component exists (combobox/tag selector, dialog/sheet, etc.).
- Avoid visual layout shifts on hover (size, spacing, or typography changes).
- For async submit actions in forms:
  - disable the full form scope (not only buttons),
  - show in-button loading indicator,
  - preserve clear pending/error/success feedback.

### UX behavior to preserve

- Default page is Kanban.
- Repository selection is modal-driven (not a standalone page).
- First launch with no repo: repository modal opens and is non-dismissible.
- Diagnostics open in a panel/modal and should auto-open only for critical failures.
- Runtime checks (`git`, `opencode`) are global; repo-specific Beads checks are per repo and cached.

## Backend / Tauri Standards

- Register every Tauri command in `tauri::generate_handler!`.
- Keep command APIs typed and return actionable errors (`Result<_, _>` patterns).
- Respect capability permissions in `apps/desktop/src-tauri/capabilities`.
- Keep long-running/blocking work off the UI thread.
- Prefer deterministic, idempotent setup flows for repo lifecycle operations.
- Do not re-run expensive repo initialization logic on every task command when cached readiness is already known.

## Beads and Task Model Rules

- Beads is the sole source of truth for tasks in V1.
- Spec markdown canonical source is issue `description`.
- Spec revisions must update `description`; do not create spec-revision comments.
- Kanban phase mapping uses Beads state dimension (`phase`) with project-defined values.
- Task forms should support structured Beads fields (title, description, design, acceptance criteria, priority, issue type, labels, parent/subtasks as applicable).

## Commands

Run from repo root unless stated otherwise:

- Install deps: `bun install`
- Frontend dev server: `bun run dev`
- Desktop app dev (Tauri): `bun run tauri:dev`
- Tauri CLI passthrough: `bun run tauri -- --version`
- Typecheck all workspaces: `bun run typecheck`
- Lint all workspaces: `bun run lint`
- Test all workspaces: `bun run test`
- Build all workspaces: `bun run build`
- Rust host check: `cd apps/desktop/src-tauri && cargo check`

## Change Workflow Expectations

- Prefer small, focused commits that follow Conventional Commits.
- Branch naming should use `codex/` prefix.
- Do not rewrite user-unrelated changes.
- Verify touched areas with relevant checks before finishing.

Minimum validation for most frontend tasks:

- `bun run --filter @openblueprint/desktop typecheck`
- `bun run --filter @openblueprint/desktop lint`

Add Rust check when host code changes:

- `cd apps/desktop/src-tauri && cargo check`

## Agent Collaboration Style

- Be explicit about assumptions and tradeoffs.
- Ask clarifying questions when requirements are ambiguous or conflicting.
- Prefer direct, actionable outputs over lengthy prose.
- Keep docs and code aligned; update nearby docs/contracts when behavior changes.

## Skill Usage (Local)

Use local skills when task scope matches:

- `beads`: task lifecycle, blockers, multi-session persistence, Beads CLI workflows.
- `tauri-v2`: command wiring, capabilities, IPC, sidecar/process integration.
- `vercel-composition-patterns`: component API design and composition refactors.
- `vercel-react-best-practices`: React performance and maintainability improvements.

If requirements are ambiguous or fast-moving, consult primary docs via Context7/web before implementing.

## References

- AGENTS.md format and guidance: [https://agents.md](https://agents.md)
- OpenAI practical agent guidance (includes AGENTS.md discovery/preference): [https://openai.github.io/openai-harmony/guides/practical-agent-coding/](https://openai.github.io/openai-harmony/guides/practical-agent-coding/)
- Bun workspaces/run filtering: [https://bun.sh/docs/pm/workspaces](https://bun.sh/docs/pm/workspaces), [https://bun.sh/docs/cli/run](https://bun.sh/docs/cli/run)
- Tauri v2 docs (permissions/capabilities/sidecar): [https://v2.tauri.app](https://v2.tauri.app)
- shadcn/ui docs: [https://ui.shadcn.com](https://ui.shadcn.com)
