# AGENTS.md

## Purpose

OpenDucktor is a Bun monorepo for a macOS-first Tauri v2 desktop app that orchestrates AI planning/building workflows with Beads as task source-of-truth.

Goals for agent contributions:

- Preserve clean hexagonal boundaries and replaceable adapters.
- Keep frontend code modular, composable, and easy to evolve.

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

## Frontend Engineering Standards

### Composition and module boundaries

- Prefer composition over monolithic components.
- Keep feature logic in feature folders and expose public APIs via `index.ts` barrels.
- Avoid god components/providers and avoid boolean-prop proliferation.
- Keep side effects and async orchestration in dedicated hooks, not UI leaf components.
- Keep page/feature files as composition roots; move orchestration into focused `use-*-controller` / `use-*-view-model` hooks.
- Split dense feature UIs into presentational slices (`*-header`, `*-body`, `*-footer`, dialogs) with narrow props.

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
- NEVER use gradient backgrounds in this project UI (no `bg-gradient-*` usage for surfaces/components).
- Avoid native browser-styled controls when a project UI component exists (combobox/tag selector, dialog/sheet, etc.).
- Prefer explicit composition APIs over boolean mode props in shared UI wrappers (e.g. `closeButton` slot instead of `showCloseButton`).
- Avoid visual layout shifts on hover (size, spacing, or typography changes).
- For async submit actions in forms:
  - disable the full form scope (not only buttons),
  - show in-button loading indicator,
  - preserve clear pending/error/success feedback.

### Styling and theming (critical)

The app uses **Shadcn semantic tokens** with **Tailwind CSS v4**. A dark theme already exists. All styling must be theme-aware.

#### Token system

Theme tokens are defined as CSS custom properties in `apps/desktop/src/styles.css` (`:root` for light, `.dark` for dark) and mapped to Tailwind via `@theme inline`. Always use these semantic tokens:

| Purpose | Use | Never use |
|---|---|---|
| Page background | `bg-background` | `bg-white`, `bg-slate-50` |
| Card/surface | `bg-card` | `bg-white` |
| Text (primary) | `text-foreground` | `text-gray-900`, `text-slate-900` |
| Text (secondary) | `text-muted-foreground` | `text-gray-500`, `text-slate-500` |
| Borders (layout) | `border-border` | `border-gray-200`, `border-slate-200` |
| Borders (inputs) | `border-input` | `border-gray-300`, `border-slate-300` |
| Subtle surfaces | `bg-muted` | `bg-gray-100`, `bg-slate-100` |
| Interactive accent | `bg-primary` / `text-primary-foreground` | `bg-sky-600` / `text-white` directly |
| Destructive | `bg-destructive` / `text-destructive` | `bg-red-500` |
| Sidebar surfaces | `bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-border` | Hardcoded equivalents |

#### When hardcoded colors are acceptable

Semantic tokens do **not** cover every use case. Hardcoded Tailwind colors are acceptable for:

- **Status/state indicators**: `bg-emerald-*` (success), `bg-sky-*` (active/info), `bg-amber-*` (warning), `bg-rose-*` (error/destructive accents).
- **Kanban lane themes**: Lane-specific accent, header, and badge colors in `kanban-theme.ts`.
- **Workflow step states**: Color-coded step indicators (done=emerald, in_progress=sky, optional=amber, blocked=muted).
- **Badges and tags**: Small decorative elements with semantic meaning (priority badges, status pills).

When using hardcoded colors, prefer **lighter shades for backgrounds** (e.g. `bg-sky-50`, `bg-emerald-50`) and **darker shades for text** (e.g. `text-sky-700`, `text-emerald-700`). These combinations generally work in both light and dark themes with minor adjustments.

#### Styling rules

1. **Never hardcode gray-scale** values for structural UI (backgrounds, text, borders). Always use semantic tokens.
2. **Use opacity modifiers** when you need lighter variants of a semantic token (e.g. `bg-muted/30`, `text-muted-foreground/60`).
3. **Tailwind Typography prose overrides** (`prose-code:*`, `prose-pre:*`, etc.) must be tested carefully — they can leak into nested components. Use CSS specificity in `styles.css` to contain them when needed.
4. **Code blocks in markdown**: The `<pre>` wrapper should be transparent/unpadded (`prose-pre:bg-transparent prose-pre:p-0`). Styling is handled by `MarkdownSyntaxBlock` for language blocks and `.markdown-body pre > code:only-child` CSS for plain blocks.
5. **Shadcn component styling**: Never override base shadcn component files with hardcoded colors. Use `className` props and semantic tokens at the usage site.
6. **Dark mode readiness**: Every new UI element must render correctly in both light and dark themes. Avoid any color that assumes a white background.

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
- Agent Studio composition root is `apps/desktop/src/pages/agents-page.tsx`; orchestration is split into `apps/desktop/src/pages/use-agent-studio-*.ts` hooks and `apps/desktop/src/pages/agents-page-view-model.ts`.
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

- `bun run --filter @openducktor/core test`
- `bun run --filter @openducktor/adapters-tauri-host test`
- `bun run --filter @openducktor/adapters-opencode-sdk test`
- `bun run --filter @openducktor/openducktor-mcp test`
- `bun run --filter @openducktor/desktop test`
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

- `bun run --filter @openducktor/desktop typecheck`
- `bun run --filter @openducktor/desktop lint`
- `bun run --filter @openducktor/desktop test`

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
