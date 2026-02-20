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
- `packages/openducktor-mcp`: MCP server exposing `odt_*` workflow tools.

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
- Runtime checks (`git`, `opencode`) are global.
- Repo-specific diagnostics (Beads + OpenCode/MCP health) are per repo and cached.
- Agent Studio is blocked unless `activeRepo` is set and repo OpenCode+MCP health is ready.
- Agent Studio role/scenario URL state (`task`, `session`, `agent`, `scenario`, `autostart`) is part of UX contract; preserve deep-link behavior.

## Backend / Tauri Standards

- Register every Tauri command in `tauri::generate_handler!`.
- Keep command APIs typed and return actionable errors (`Result<_, _>` patterns).
- Respect capability permissions in `apps/desktop/src-tauri/capabilities`.
- Keep long-running/blocking work off the UI thread.
- Prefer deterministic, idempotent setup flows for repo lifecycle operations.
- Do not re-run expensive repo initialization logic on every task command when cached readiness is already known.

## Beads and Task Model Rules

- Beads is the sole source of truth for tasks in V1.
- Lifecycle state is Beads `status` (not labels/phases).
- Canonical statuses:
  - built-in: `open`, `in_progress`, `blocked`, `deferred`, `closed`
  - custom: `spec_ready`, `ready_for_dev`, `ai_review`, `human_review`
- UI label mapping:
  - `open` => Backlog
  - `closed` => Done
  - `deferred` => hidden from Kanban (for now)
- Agent-authored docs are metadata-only under configurable namespace (`taskMetadataNamespace`, default `openducktor`):
  - `documents.spec` (latest-only list in V1)
  - `documents.implementationPlan` (latest-only list in V1)
  - `documents.qaReports` (append-only history)
- Task action names are defined in `packages/contracts/src/index.ts` (`taskActionSchema`).
- Detailed workflow docs:
  - `docs/task-workflow-status-model.md`
  - `docs/task-workflow-transition-matrix.md`
  - `docs/task-workflow-actions.md`

## MCP and Agent Studio Contract (Critical)

Keep this contract stable. If you change any item below, update all related layers in the same change.

- Canonical MCP server name is `openducktor`.
- Canonical tool list and schemas live in `packages/openducktor-mcp/src/lib.ts` (`ODT_TOOL_SCHEMAS`).
- MCP workflow tools: `odt_read_task`, `odt_set_spec`, `odt_set_plan`, `odt_build_blocked`, `odt_build_resumed`, `odt_build_completed`, `odt_qa_approved`, `odt_qa_rejected`.
- Canonical role-to-tool policy lives in `packages/core/src/types/agent-orchestrator.ts` (`AGENT_ROLE_TOOL_POLICY`).
- Role allowlist: `spec` => `odt_read_task, odt_set_spec`; `planner` => `odt_read_task, odt_set_plan`; `build` => `odt_read_task, odt_build_blocked, odt_build_resumed, odt_build_completed`; `qa` => `odt_read_task, odt_qa_approved, odt_qa_rejected`.
- Workflow tool normalization/alias handling lives in `packages/core/src/services/odt-workflow-tools.ts`.
- Agent Studio orchestration source-of-truth is `apps/desktop/src/pages/agents-page.tsx`.
- Agent runtime/session orchestration and permission guardrails live in `apps/desktop/src/state/operations/use-agent-orchestrator-operations.ts`.
- Read-only roles (`spec`, `planner`, `qa`) must keep mutating permission auto-rejection behavior.
- Do not rename `odt_*` workflow tools or change role allowlists in a single layer; update MCP, core policy, adapter, and frontend together.

## Testing Policy

### Scope

- Non-frontend code must be deeply tested:
  - Rust backend crates
  - `packages/core`
  - adapter packages (`packages/adapters-*`)
  - `packages/openducktor-mcp`
- Frontend tests are active and required for touched frontend behavior.

### Required checks before finishing non-UI changes

- Rust:
  - `cd apps/desktop/src-tauri && cargo check`
  - `cd apps/desktop/src-tauri && cargo test`
- Bun workspaces:
  - `bun run typecheck`
  - `bun run test`

### Package-level targets for focused iteration

- `bun run --filter @openblueprint/core test`
- `bun run --filter @openblueprint/adapters-tauri-host test`
- `bun run --filter @openblueprint/adapters-opencode-sdk test`
- `bun run --filter @openblueprint/openducktor-mcp test`
- `bun run --filter @openblueprint/desktop test`
- `cd apps/desktop/src-tauri && cargo test -p host-domain`
- `cd apps/desktop/src-tauri && cargo test -p host-infra-system`
- `cd apps/desktop/src-tauri && cargo test -p host-infra-beads`
- `cd apps/desktop/src-tauri && cargo test -p host-application`

### Test quality standards

- Test behavior, not implementation details.
- Prefer deterministic unit tests over fragile integration tests.
- Cover error paths and guardrails, not only happy paths.
- For adapters, test command routing, payload shapes, and schema parsing failures.
- For workflow logic, test transition rules and invariants (epic/subtask guardrails, deferred handling, QA transitions).
- When fixing a bug, add a regression test in the package where the bug originated.
- Keep tests readable with helper builders/factories to avoid duplication.

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
- `bun run --filter @openblueprint/desktop test`

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
