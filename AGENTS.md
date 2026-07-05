# AGENTS.md

## Project

OpenDucktor is a **Bun monorepo** for an **Electron** desktop app and local browser runner that orchestrate AI planning/building workflows with a workspace-scoped **SQLite task store** as task source-of-truth.

Package manager: **Bun** (not npm/yarn). All workspace commands use `bun run`.

## Critical Notice — No Fallbacks

- NEVER implement fallback logic to mask failures.
- Fix root causes at the source layer where the failure originates.
- If a call fails, return/propagate an actionable error instead of silent defaults.
- Do not add secondary probes or alternate paths to hide broken primary behavior.
- Do not add polling/retry loops for data that should arrive through an existing live event stream or subscription; fix the event/stream contract instead.

## Critical Notice — Keep it simple

- ALWAYS try to keep the code simple
- AVOID "normalization" unless it's absolutely necessary
- NEVER harden code without a good reason

## Critical Notice — Runtime Source Evidence

- When behavior depends on external runtime internals, inspect the runtime source or official contract before designing or changing adapters.
- Never infer runtime behavior from memory, adapter shape, or assumptions when source evidence is available.

## Critical Notice — Human Validation for Database Schema

- NEVER change database schemas, migration files, persisted record schemas, or durable SQLite/task-store record shapes without explicit human validation.
- If a fix appears to require persisting new data or changing durable storage shape, stop and ask for approval first.

### Monorepo Map

- `apps/electron`: Electron desktop shell, renderer bootstrap, preload bridge, packaging, and IPC transport.
- `packages/frontend`: Shared React + Vite UI.
- `packages/contracts`: Shared runtime schemas and IPC contracts (TS).
- `packages/core`: Core domain services and ports.
- `packages/host`: Effect-native TypeScript host for Electron/web transports, command routing, application use cases, and infrastructure adapters.
- `packages/adapters-opencode-sdk`: `AgentEnginePort` adapter.
- `packages/host-client`: Frontend IPC adapter.
- `packages/openducktor-mcp`: MCP server exposing `odt_*` workflow tools.

When adding a new workspace app/package under `apps/*` or `packages/*`, update `.serena/project.yml` `additional_workspace_folders` and run `serena project health-check .` so Serena keeps monorepo cross-package references working.

## Architecture

### Hexagonal rules

- Port definitions live in core/domain layers, adapters in infra layers.
- Do not couple UI code directly to infra when contracts exist.
- When changing data contracts, update `packages/contracts` first, then adapt host/frontend.

### Effect adoption rules

- `packages/host` is Effect-native internally. Fallible or I/O-producing host ports and application services should return `Effect.Effect<Success, Failure, Requirements>`, not raw `Promise`.
- Keep Promise interop at explicit transport boundaries only: Electron IPC, browser HTTP/SSE, shell bridge adapters, and external package APIs that must remain Promise-compatible.
- Expected host failures should use typed errors, preferably `Data.TaggedError`, and be propagated through the Effect error channel. Do not use generic `throw new Error(...)` for expected host failures.
- Use `Effect.gen` for readable sequencing, `Context.Tag`/`Layer` for host dependency wiring when it clarifies composition, and `Effect.try`/`Effect.tryPromise` only to wrap synchronous or Promise-based external APIs at the boundary.
- Do not use `catchAll`, retry, fallback, or defaulting to hide broken contracts. Retrying/polling must represent explicit product behavior and should use Effect scheduling primitives.
- Pure domain policy code may stay synchronous when it has no I/O and no useful typed failure channel. Effect is the host execution model, not a mandate to wrap every expression.
- `packages/contracts` remains the public Zod contract source until a separate schema ADR changes that. Do not duplicate public schemas in Effect Schema as a second source of truth.
- TanStack Query remains the frontend cache/deduplication layer for server-owned reads. Effect may run behind host clients or query functions, but it must not introduce a competing frontend cache or request store.

### Replaceable boundaries

- TS port: `AgentEnginePort` in `packages/core/src/ports/agent-engine.ts`

### Runtime abstraction rules

- Treat runtime definitions, runtime routes, and runtime connections as different layers.
- Shared host-visible runtime/run payloads live in `packages/contracts/src/run-schemas.ts`.
- `RuntimeInstanceSummary` is live runtime-instance metadata only: keep `kind`, `runtimeId`, `repoPath`, nullable `taskId`, `role`, `workingDirectory`, `runtimeRoute`, `startedAt`, and `descriptor`. Do not reintroduce top-level `endpoint`, `port`, or duplicate `capabilities` fields there.
- Keep `runtimeId` and `runtimeRoute` at runtime-registry/adapter depth. UI and orchestration should carry `runtimeKind`, repository path, working directory, and session id.
- Request-scoped agent engine operations use `runtimeConnection` objects, not raw shared `runtimeEndpoint` strings. Build adapter-local client inputs from the connection at the adapter boundary.
- Persisted session records/documents must not store live runtime route data (`runtimeEndpoint`, `baseUrl`, `runtimeTransport`). Persist durable identifiers plus `workingDirectory`, then resolve a live route only at the adapter call boundary.
- Keep runtime routing fail-fast. Never fall back from a session/build runtime to the repo default runtime when loading session history, todos, diff, or file status.
- Keep runtime capability definitions in runtime descriptors (`packages/contracts/src/agent-runtime-schemas.ts`). Do not duplicate capability booleans onto runtime-instance summaries.

## Commands

Run from repo root unless stated otherwise:

```sh
bun install                  # install deps
bun run dev                  # frontend dev server
bun run electron:dev         # Electron desktop dev server
bun run browser:dev          # local browser runner
bun run typecheck            # typecheck all workspaces
bun run lint                 # lint all workspaces
bun run test                 # test all workspaces
bun run build                # build all workspaces
```

Package-level targets for focused iteration:

```sh
bun run --filter @openducktor/frontend test
```

## Styling & Theming (Critical)

The app uses **Shadcn semantic tokens** with **Tailwind CSS v4**. A dark theme exists. All styling must be theme-aware.

### Token system

Tokens are CSS custom properties in `packages/frontend/src/styles.css` (`:root` light, `.dark` dark) mapped to Tailwind via `@theme inline`. **Always use semantic tokens:**

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
5. Use shadcn components from `packages/frontend/src/components/ui`. Avoid native browser-styled controls when a project component exists.

## Frontend Patterns

- State management contexts are wired in `packages/frontend/src/state/app-state-provider.tsx`.
- Domain operations live in focused hooks under `packages/frontend/src/state/{lifecycle,operations,tasks}`.
- Use operation-specific loading flags (`isLoadingTasks`, `isLoadingChecks`), not generic busy flags.
- Centralize shared types under `packages/frontend/src/types`; use feature-level `constants.ts` over magic strings.
- For async form submissions: disable the full form scope, show in-button loading, and preserve pending/error/success feedback.
- Avoid nested ternaries in app and test code. Prefer named booleans, helper functions, lookup maps, or explicit `if`/`else` control flow so state rules stay readable.

### TanStack Query Rules

- TanStack Query is the default cache and deduplication layer for frontend reads that come from the backend or host adapters.
- MUST use TanStack Query for server-owned read data that can be requested from multiple places, reused across screens, refreshed, invalidated after mutations, or deduplicated in flight.
- MUST use TanStack Query for stable host reads such as settings snapshots, repo config, runtime definitions, tasks/runs lists, branches/current branch, diagnostics, session lists, and git status snapshots unless there is a documented exception.
- MUST define query keys and query option builders in focused modules under `packages/frontend/src/state/queries`.
- MUST use `useQuery` / `useQueries` / `useSuspenseQuery` in React render paths that read backend-owned data.
- MUST use `queryClient.fetchQuery`, `ensureQueryData`, `prefetchQuery`, or cache invalidation APIs for imperative backend reads outside render paths.
- MUST invalidate or update the relevant TanStack Query cache entries after any mutation that changes cached server data.
- MUST prefer deriving UI state from query results over copying query data into local component state unless the copied state is a true user-editable draft.
- MUST NOT add new ad hoc request caches, singleton in-flight maps, or `useEffect`+`useState` fetch loops for backend reads when TanStack Query can own that data.
- MUST NOT use TanStack Query as the primary store for transient UI state, local form drafts, modal visibility, optimistic text input, or event-stream assembly.
- MUST NOT move live streaming agent transcript state, in-progress tool output, pending permission/question interactions, or other event-driven session state into TanStack Query unless the underlying data becomes request/response based.
- When adapting existing provider APIs, it is acceptable to keep the provider contract stable while making the underlying read path use TanStack Query.

## Backend / Host

- Keep host command APIs typed and schema-validated.
- Expected host failures should be actionable typed errors.
- Keep blocking work off the UI thread.
- Do not re-run expensive repo initialization when cached readiness is known.

## SQLite Task Store & Task Model

- The SQLite task store is the sole source of truth for tasks.
- Task-store records must store durable task/workflow state only. Do not persist transient runtime or session interaction state there.
- Never serialize pending permissions, pending questions, live runtime routes, in-progress transcripts, tool streaming state, or other recoverable live-only values into task-store records. Rehydrate those from the live runtime, event stream, or runtime-owned history instead.
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
- Agent Studio root: `packages/frontend/src/pages/agents/agents-page.tsx`; orchestration in `use-agent-studio-*.ts` hooks.
- Runtime/session orchestration: `packages/frontend/src/state/operations/use-agent-orchestrator-operations.ts`.
- Do not rename `odt_*` tools or change role allowlists in a single layer — update MCP, core, adapter, and frontend together.

## Testing

- All non-frontend code must be deeply tested (`packages/host`, `packages/core`, adapters, MCP).
- Frontend tests are required for touched behavior.
- Always run relevant checks before finishing — see Commands section above.
- NEVER change production APIs, constructors, options, or exported types only to make tests easier or faster. Test-only seams must come from narrower test helpers, local fakes around existing boundaries, or refactoring that improves production design on its own merits.
- In Bun tests, NEVER mock shared re-export barrels such as `@/state`, `@/components`, or other `index.ts` aggregator modules. Mock the source module that owns the export instead (for example `@/state/app-state-provider`), otherwise Bun can bind an incomplete export surface and leak that mock across files.
- In Bun tests, register `mock.module(...)` in scoped setup (`beforeAll`/`beforeEach`) only when you truly need a module seam. Prefer dependency injection, direct function parameters, or `spyOn`-style seams over module replacement whenever possible.
- In Bun tests, NEVER keep `mock.module(...)` active for the lifetime of a whole file via `beforeAll`/`afterAll`. Bun can interleave files in one process, so file-lifetime module mocks can leak into unrelated suites. Prefer no module mock at all; if unavoidable, scope it to the smallest possible test surface and restore it immediately after that scope.
- In Bun tests, NEVER use `mock.restore()` as cleanup for `mock.module(...)`. `mock.restore()` is process-wide, can wipe unrelated spies/mocks in concurrently running files, and Bun docs do not treat it as reliable module-mock teardown.
- In Bun tests, if you register `mock.module(...)`, you MUST restore that exact module id in teardown by remocking it back to the real module (or equivalent exact-id cleanup). Do not leave module mocks active beyond the suite, and do not replace cleanup with nothing.
- In Bun tests, if one file needs the real implementation while another keeps a module mock, remock the exact module id back to the real implementation or import the real module through an isolated path. Do not use process-wide global restore for module cleanup in shared suite runs.
- In Bun tests, when restoring a mocked module id, NEVER load the "real" module through that same mocked specifier while the mock is still active. Capture the real module before mocking, or restore from a non-mocked source path; otherwise the restore can silently re-import the mock.
- In Bun tests, the mocked module id MUST exactly match the import string used by the code under test. If production code imports `@/foo/bar`, do not mock `./bar` and assume Bun will unify them.
- In Bun tests, if the code under test imports a dependency through a relative path or other non-barrel specifier, mock that exact import string in the test. Do not rely on mocking only an upstream alias or barrel module and assume Bun will route the dependency through it.
- Do not mutate shared singletons in tests when a local seam is possible. Avoid patching process-wide objects such as `host`, shared query clients, exported adapters, or other module-level state unless there is no narrower option and the test restores the mutation in `finally`/`afterEach`.
- Prefer dependency injection or hook parameters over module mocks when testing logic that depends on host adapters, TanStack Query hooks, or app-state hooks. Small explicit seams are more stable than process-wide module replacement.
- For hook tests that only need one app-state selector or one host read, prefer mocking that exact hook/function seam over wiring a larger fake provider or store graph. This keeps the test faster and less sensitive to CI scheduling.
- Any test that exercises code using TanStack Query MUST provide its own isolated query client. Use `QueryProvider` with `useIsolatedClient` in tests; never rely on the app-global query client or on cache state left by previous tests.
- Any test that renders a hook/component using app-state hooks such as `useWorkspaceState` MUST provide the minimal required context providers explicitly. Do not rely on ambient providers from unrelated test setup.
- Render-only tests using `renderToStaticMarkup` still need the same required providers as client-rendered tests if the component calls hooks that depend on Query/context state.
- When a test only needs to verify that one dependency receives the right inputs, prefer a focused hook test with injected fakes over a component-level module mock. This avoids coupling the assertion to Bun’s module cache behavior.
- Treat default short polling windows as suspicious in CI. If a test waits for async query work or portal/render scheduling, use an explicit timeout with `waitFor(...)` or the harness wait helper instead of assuming `200ms` is enough.
- Any explicit test wait timeout must stay below the enclosing Bun test timeout. Do not write waits that can outlive the suite timeout, because CI will report a generic test timeout instead of the real failing assertion.
- When chasing flakes, run verification commands sequentially, not in parallel. Parallel local verification can create false negatives by contending for the same Bun test process resources and obscuring the real leak.
- Prefer focused hook/module tests over broad page-level integration tests when asserting orchestration or routing behavior. Broad page tests with React Query, routers, and heavy module mocking are much more likely to leak handles and hang the Bun runner.
- Test fixtures must return isolated nested data. Never share mutable nested objects or arrays between tests through top-level fixture constants.

### Browser App Testing

- For end-to-end UI validation in browser mode, use `agent-browser` against the live app served by the real OpenDucktor backend.
- Treat browser mode as the default way to validate UI work in this repo when browser automation is sufficient.
- Do **not** run `bun run browser:dev` yourself.
- Ask the user to start `bun run browser:dev`, then connect to the running app in the browser.

## Workflow

- Use Conventional Commits.
- Verify touched areas with relevant checks before finishing.
