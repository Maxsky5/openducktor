# AGENTS.md

## Critical Notice — No Fallbacks

- NEVER implement fallback logic to mask failures.
- Fix root causes at the source layer where the failure originates.
- If a call fails, return/propagate an actionable error instead of silent defaults.
- Do not add secondary probes or alternate paths to hide broken primary behavior.

## Project

OpenDucktor is a **Bun monorepo** for a macOS-first **Tauri v2** desktop app that orchestrates AI planning/building workflows with **Beads** as task source-of-truth.

Package manager: **Bun** (not npm/yarn). All workspace commands use `bun run`.

### Monorepo Map

- `apps/desktop`: React + Vite UI and Tauri host integration.
- `apps/desktop/src-tauri`: Rust host application and infra crates.
- `packages/contracts`: Shared runtime schemas and IPC contracts (TS).
- `packages/core`: Core domain services and ports.
- `packages/adapters-opencode-sdk`: `AgentEnginePort` adapter.
- `packages/adapters-tauri-host`: Frontend IPC adapter.
- `packages/openducktor-mcp`: MCP server exposing `odt_*` workflow tools.

## Architecture

### Hexagonal rules

- Port definitions live in core/domain layers, adapters in infra layers.
- Do not couple UI code directly to infra when contracts exist.
- When changing data contracts, update `packages/contracts` first, then adapt host/frontend.

### Replaceable boundaries

- TS port: `AgentEnginePort` in `packages/core/src/ports/agent-engine.ts`
- Rust trait: `TaskStore` defined in `apps/desktop/src-tauri/crates/host-domain/src/store.rs` and re-exported by `apps/desktop/src-tauri/crates/host-domain/src/lib.rs`

### Runtime abstraction rules

- Treat runtime definitions, runtime routes, and runtime connections as different layers.
- Shared host-visible runtime/run payloads live in `packages/contracts/src/run-schemas.ts`; update Rust host types in `apps/desktop/src-tauri/crates/host-domain/src/runtime.rs` in the same change.
- `AgentRuntimeSummary` is live runtime-instance metadata only: keep `kind`, `runtimeId`, `repoPath`, nullable `taskId`, `role`, `workingDirectory`, `runtimeRoute`, `startedAt`, and `descriptor`. Do not reintroduce top-level `endpoint`, `port`, or duplicate `capabilities` fields there.
- Request-scoped agent engine operations use `runtimeConnection` objects, not raw shared `runtimeEndpoint` strings. Build adapter-local client inputs from the connection at the adapter boundary.
- Persisted session records/documents must not store live runtime route data (`runtimeEndpoint`, `baseUrl`, `runtimeTransport`). Persist durable identifiers plus `workingDirectory`, then resolve a live route during hydration.
- Keep runtime routing fail-fast. Never fall back from a session/build runtime to the repo default runtime when loading session history, todos, diff, or file status.
- Keep runtime capability definitions in runtime descriptors (`packages/contracts/src/agent-runtime-schemas.ts` and Rust descriptor equivalents). Do not duplicate capability booleans onto runtime-instance summaries.

## Commands

Run from repo root unless stated otherwise:

```sh
bun install                  # install deps
bun run dev                  # frontend dev server
bun run tauri:dev            # desktop app dev (Tauri)
bun run typecheck            # typecheck all workspaces
bun run lint                 # lint all workspaces
bun run test                 # test all workspaces
bun run build                # build all workspaces
```

Rust host: `cd apps/desktop/src-tauri && cargo check` / `cargo test`

Package-level targets for focused iteration:

```sh
bun run --filter @openducktor/core test
bun run --filter @openducktor/desktop test
bun run --filter @openducktor/desktop typecheck
bun run --filter @openducktor/desktop lint
cd apps/desktop/src-tauri && cargo test -p host-domain
cd apps/desktop/src-tauri && cargo test -p host-infra-beads
cd apps/desktop/src-tauri && cargo test -p host-application
```

## Styling & Theming (Critical)

The app uses **Shadcn semantic tokens** with **Tailwind CSS v4**. A dark theme exists. All styling must be theme-aware.

### Token system

Tokens are CSS custom properties in `apps/desktop/src/styles.css` (`:root` light, `.dark` dark) mapped to Tailwind via `@theme inline`. **Always use semantic tokens:**

| Purpose | Use | Never use |
|---|---|---|
| Page background | `bg-background` | `bg-white`, `bg-slate-50` |
| Card/surface | `bg-card` | `bg-white` |
| Text (primary) | `text-foreground` | `text-gray-900` |
| Text (secondary) | `text-muted-foreground` | `text-gray-500` |
| Borders (layout) | `border-border` | `border-gray-200` |
| Borders (inputs) | `border-input` | `border-gray-300` |
| Subtle surfaces | `bg-muted` | `bg-gray-100` |
| Interactive accent | `bg-primary` / `text-primary-foreground` | `bg-sky-600` |
| Destructive | `bg-destructive` / `text-destructive` | `bg-red-500` |
| Sidebar | `bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-border` | Hardcoded equivalents |

### Hardcoded colors — only acceptable for

- **Status indicators**: `bg-emerald-*` (success), `bg-sky-*` (info), `bg-amber-*` (warning), `bg-rose-*` (error).
- **Kanban lane themes**: accent colors in `kanban-theme.ts`.
- **Badges/tags**: small decorative elements with semantic meaning.

Prefer light shades for backgrounds (`bg-sky-50`) and dark for text (`text-sky-700`).

### Styling rules

1. Never hardcode gray-scale for structural UI. Always use semantic tokens.
2. NEVER use gradient backgrounds (`bg-gradient-*`) for surfaces/components.
3. Use `className` props and semantic tokens at usage sites — never override base shadcn component files with hardcoded colors.
4. Every new UI element must work in both light and dark themes.
5. Use shadcn components from `apps/desktop/src/components/ui`. Avoid native browser-styled controls when a project component exists.

## Frontend Patterns

- State management contexts are wired in `apps/desktop/src/state/app-state-provider.tsx`.
- Domain operations live in focused hooks under `apps/desktop/src/state/{lifecycle,operations,tasks}`.
- Use operation-specific loading flags (`isLoadingTasks`, `isLoadingChecks`), not generic busy flags.
- Centralize shared types under `apps/desktop/src/types`; use feature-level `constants.ts` over magic strings.
- For async form submissions: disable the full form scope, show in-button loading, and preserve pending/error/success feedback.

## Backend / Tauri

- Register every Tauri command in `tauri::generate_handler!`.
- Keep command APIs typed; return `Result<_, _>` with actionable errors.
- Respect capability permissions in `apps/desktop/src-tauri/capabilities`.
- Keep blocking work off the UI thread.
- Do not re-run expensive repo initialization when cached readiness is known.

## Beads & Task Model

- Beads is the sole source of truth for tasks in V1.
- Lifecycle state is Beads `status` (not labels/phases).
- Canonical statuses:
  - built-in: `open`, `in_progress`, `blocked`, `deferred`, `closed`
  - custom: `spec_ready`, `ready_for_dev`, `ai_review`, `human_review`
- UI label mapping: `open` → Backlog, `closed` → Done, `deferred` → hidden from Kanban.
- Agent-authored docs are metadata under `openducktor` namespace: `documents.spec`, `documents.implementationPlan` (latest-only), `documents.qaReports` (append-only).
- Task actions defined in `packages/contracts/src/task-schemas.ts` (`taskActionSchema`).
- Detailed workflow docs: `docs/task-workflow-*.md`

## MCP & Agent Studio Contract (Critical)

Keep this contract stable. If you change any item below, update all related layers together.

- MCP server name: `openducktor`.
- Tool schemas: `packages/openducktor-mcp/src/lib.ts` (`ODT_TOOL_SCHEMAS`).
- Workflow tools: `odt_read_task`, `odt_set_spec`, `odt_set_plan`, `odt_build_blocked`, `odt_build_resumed`, `odt_build_completed`, `odt_qa_approved`, `odt_qa_rejected`.
- Role-to-tool policy: `packages/core/src/types/agent-orchestrator.ts` (`AGENT_ROLE_TOOL_POLICY`).
- Role allowlist: `spec` → `odt_read_task, odt_set_spec`; `planner` → `odt_read_task, odt_set_plan`; `build` → `odt_read_task, odt_build_*`; `qa` → `odt_read_task, odt_qa_*`.
- Workflow tool normalization: `packages/core/src/services/odt-workflow-tools.ts`.
- Agent Studio root: `apps/desktop/src/pages/agents-page.tsx`; orchestration in `use-agent-studio-*.ts` hooks.
- Runtime/session orchestration: `apps/desktop/src/state/operations/use-agent-orchestrator-operations.ts`.
- Read-only roles (`spec`, `planner`, `qa`) must keep mutating permission auto-rejection.
- Do not rename `odt_*` tools or change role allowlists in a single layer — update MCP, core, adapter, and frontend together.

## Testing

- All non-frontend code must be deeply tested (Rust crates, `packages/core`, adapters, MCP).
- Frontend tests are required for touched behavior.
- Always run relevant checks before finishing — see Commands section above.

## Workflow

- Conventional Commits, `codex/` branch prefix.
- Verify touched areas with relevant checks before finishing.
