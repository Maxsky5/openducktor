# AGENTS.md

## Project

OpenDucktor is a Bun monorepo. It contains an Electron desktop app and a local browser runner. Both run AI planning and build workflows. A workspace-scoped SQLite task store is the source of truth for tasks.

Use Bun. Run workspace commands with `bun run`. Do not use npm or Yarn.

## Hard rules

### Do not hide failures

- NEVER add fallback logic that hides a failure.
- Fix the cause in the source layer.
- If a call fails, return or propagate an error that tells the user what to do.
- Do not add a second probe or an alternate path to hide a failure in the main path.
- Do not add a poll or retry loop for data that must come from an existing live event stream or subscription.
- Fix the event or stream contract.

### Keep code simple

- Keep the main path direct.
- Add normalization or extra checks only when a known case needs them.
- Do not add defensive code without a clear reason.

### Verify runtime behavior

- Inspect the runtime source or an official contract before you design or change an adapter that depends on external runtime behavior.
- Do not infer runtime behavior from memory, an adapter shape, or an assumption when source evidence is available.

### Get approval before durable data changes

- NEVER change a database schema, migration file, persisted record schema, or durable SQLite task-store record shape without explicit human approval.
- If a change needs new persisted data or a change to durable storage, stop and ask for approval.

## Monorepo map

- `apps/electron`: Electron desktop shell, renderer startup, preload bridge, packaging, and IPC transport.
- `packages/frontend`: Shared React and Vite UI.
- `packages/contracts`: Shared runtime schemas and IPC contracts.
- `packages/core`: Core domain services and ports.
- `packages/host`: Effect-native TypeScript host for Electron and web transports, command routing, application use cases, and infrastructure adapters.
- `packages/adapters-opencode-sdk`: `AgentEnginePort` adapter.
- `packages/host-client`: Frontend IPC adapter.
- `packages/openducktor-mcp`: MCP server that exposes `odt_*` workflow tools.

## Architecture

### Hexagonal rules

- Define ports in core or domain code.
- Put adapters in infrastructure code.
- Use an existing contract instead of coupling UI code to infrastructure code.
- Change `packages/contracts` before you change host or frontend code that uses a data contract.

### Effect rules

Read [docs/effect.md](docs/effect.md) before you change a host port, service, adapter, lifecycle, or typed error.

- Treat `packages/host` as Effect-native.
- A host port or application service that performs I/O or can fail must return `Effect.Effect<Success, Failure, Requirements>`, not a raw `Promise`.
- Keep Promise interop at explicit transport boundaries: Electron IPC, browser HTTP/SSE, shell bridge adapters, and external package APIs that require Promise values.
- Model expected host failures as typed errors.
- Prefer `Data.TaggedError` for expected host failures.
- Propagate expected failures through the Effect error channel.
- Do not use `throw new Error(...)` for an expected host failure.
- Use `Effect.gen` for clear sequences.
- Use `Context.Tag` and `Layer` when they make host dependency wiring clear.
- Use `Effect.try` and `Effect.tryPromise` only at synchronous or Promise-based external boundaries.
- Do not use `catchAll`, retry, fallback, or a default to hide a failed contract.
- Use an Effect schedule when a retry or poll is explicit product behavior.
- Keep pure domain policy code synchronous when it has no I/O and no useful typed failure channel.
- Do not wrap every expression in Effect.
- Keep public Zod schemas in `packages/contracts` until a separate schema ADR changes this rule.
- Do not create a second public schema source with Effect Schema.
- Use TanStack Query as the frontend cache and deduplication layer for server-owned reads.
- Do not use Effect to add a second frontend cache or request store behind a host client or query function.

### Replaceable boundaries

- TS port: `AgentEnginePort` in `packages/core/src/ports/agent-engine.ts`.

### Runtime rules

- Treat runtime definitions, runtime routes, and runtime connections as separate layers.
- Keep shared host-visible runtime and run payloads in `packages/contracts/src/run-schemas.ts`.
- Keep `RuntimeInstanceSummary` limited to `kind`, `runtimeId`, `repoPath`, nullable `taskId`, `role`, `workingDirectory`, `runtimeRoute`, `startedAt`, and `descriptor`.
- Do not add top-level `endpoint`, `port`, or duplicate `capabilities` fields to `RuntimeInstanceSummary`.
- Keep `runtimeId` and `runtimeRoute` in the runtime registry and adapters.
- Make UI and orchestration code carry `runtimeKind`, repository path, working directory, and session ID.
- Pass `runtimeConnection` objects to request-scoped agent engine operations.
- Build adapter-specific client input at the adapter boundary.
- Do not store `runtimeEndpoint`, `baseUrl`, `runtimeTransport`, or other live route data in persisted session records or documents.
- Store durable IDs and `workingDirectory` in session records.
- Resolve the live route at the adapter call boundary.
- Resolve the route for the selected session or build.
- Do not fall back to the repository default runtime for history, todos, diff, or file status.
- Define runtime capabilities in `packages/contracts/src/agent-runtime-schemas.ts`.
- Do not copy capability flags to runtime instance summaries.

## Commands

Run these commands from the repository root.

```sh
bun install
bun run dev
bun run electron:dev
bun run browser:dev
bun run typecheck
bun run lint
bun run test
bun run build
```

Run a focused workspace test with this form.

```sh
bun run --filter @openducktor/frontend test
```

## Styling and themes

The app uses shadcn semantic tokens with Tailwind CSS v4. It supports light and dark themes. Tokens are in `packages/frontend/src/styles.css`.

| Purpose | Use | Do not use |
|---|---|---|
| Page background | `bg-background` | `bg-white`, `bg-slate-50` |
| Card or surface | `bg-card` | `bg-white` |
| Main text | `text-foreground` | `text-gray-900` |
| Secondary text | `text-muted-foreground` | `text-gray-500` |
| Layout border | `border-border` | `border-gray-200` |
| Input border | `border-input` | `border-gray-300` |
| Subtle surface | `bg-muted` | `bg-gray-100` |
| Interactive accent | `bg-primary`, `text-primary-foreground` | `bg-sky-600` |
| Destructive action | `bg-destructive`, `text-destructive` | `bg-red-500` |
| Sidebar | `bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-border` | Hardcoded colors |

### Allowed hardcoded colors

- Use hardcoded colors for status indicators: `bg-emerald-*` for success, `bg-sky-*` for information, `bg-amber-*` for a warning, and `bg-rose-*` for an error.
- Use the accent colors in `kanban-theme.ts` for Kanban lane themes.
- Use hardcoded colors for small badges and tags that have semantic meaning.
- Prefer a light background such as `bg-sky-50` and dark text such as `text-sky-700`.
- Add dark-theme classes.

### Styling rules

1. Use semantic tokens for structural UI instead of hardcoded gray colors.
2. NEVER use a gradient background such as `bg-gradient-*` for a surface or component.
3. Apply semantic tokens with `className` at the use site.
4. Make each new UI element work in light and dark themes.
5. Do not change a base shadcn component to add hardcoded colors.
6. Use components from `packages/frontend/src/components/ui` when one exists.
7. Do not use a native browser-styled control when a project component exists.

## Frontend

- Wire state contexts in `packages/frontend/src/state/app-state-provider.tsx`.
- Put domain operations in focused hooks under `packages/frontend/src/state/{lifecycle,operations,tasks}`.
- Use operation-specific flags such as `isLoadingTasks` and `isLoadingChecks`.
- Do not use a generic busy flag.
- Put shared types in `packages/frontend/src/types`.
- Put feature constants in `constants.ts`.
- Do not use magic strings.
- During an async form submission, disable the full form, show loading in the submit button, and keep pending, error, or success feedback visible.
- Replace nested ternaries in app and test code with named booleans, helper functions, lookup maps, or explicit `if` and `else` statements.

### TanStack Query rules

Read [docs/tanstack-query-cache-strategy.md](docs/tanstack-query-cache-strategy.md) before you add or change a frontend read from the host or backend.

- MUST use TanStack Query for server-owned read data that can be requested from more than one place, reused across screens, refreshed, invalidated after a mutation, or deduplicated in flight.
- MUST use TanStack Query for stable host reads such as settings snapshots, repository configuration, runtime definitions, task and run lists, branches and the current branch, diagnostics, session lists, and Git status snapshots unless a documented exception applies.
- MUST define query keys and query option builders in focused modules under `packages/frontend/src/state/queries`.
- MUST use `useQuery`, `useQueries`, or `useSuspenseQuery` in React render paths that read backend-owned data.
- MUST use `queryClient.fetchQuery`, `ensureQueryData`, `prefetchQuery`, or cache invalidation APIs for imperative backend reads outside render paths.
- MUST invalidate or update each TanStack Query cache entry after a mutation changes its server data.
- MUST derive UI state from query results.
- Copy query data to local component state only when the copy is a user-editable draft.
- MUST NOT add an ad hoc request cache, singleton in-flight map, or `useEffect` and `useState` fetch loop for a backend read that TanStack Query can own.
- MUST NOT use TanStack Query as the main store for transient UI state, form drafts, modal state, optimistic text input, or event-stream assembly.
- MUST NOT move live agent transcripts, in-progress tool output, pending permission or question state, or other event-driven session state into TanStack Query unless the data becomes request-response data.
- Keep an existing provider API stable when only its read path must move to TanStack Query.

## Host

- Keep host command APIs typed and schema-validated.
- Return actionable typed errors for expected host failures.
- Keep blocking work off the UI thread.
- Reuse known repository readiness.
- Do not repeat costly repository setup.

## SQLite task store

- Treat the SQLite task store as the only source of truth for tasks.
- Store only durable task and workflow state in task records.
- Do not store pending permissions, pending questions, live runtime routes, in-progress transcripts, tool stream state, or other recoverable live-only values in task records.
- Rebuild live-only values from the live runtime, event stream, or runtime history.
- Find task actions in `packages/contracts/src/task-schemas.ts` under `taskActionSchema`.
- Read the applicable `docs/task-workflow-*.md` file before you change a task state or action.

## MCP and Agent Studio contract

Keep this contract stable. If you change one item, update all affected layers in the same change.

- Server name: `openducktor`.
- Tool schemas: `ODT_TOOL_SCHEMAS` in `packages/openducktor-mcp/src/lib.ts`.
- Workflow tools: `odt_read_task`, `odt_read_task_assets`, `odt_read_task_documents`, `odt_set_spec`, `odt_set_plan`, `odt_build_blocked`, `odt_build_resumed`, `odt_build_completed`, `odt_set_pull_request`, `odt_qa_approved`, and `odt_qa_rejected`.
- Role policy: `AGENT_ROLE_TOOL_POLICY` in `packages/core/src/types/agent-orchestrator.ts`.
- Role allowlist: all roles can call `odt_read_task`, `odt_read_task_assets`, and `odt_read_task_documents`; `spec` adds `odt_set_spec`; `planner` adds `odt_set_plan`; `build` adds `odt_build_*` and `odt_set_pull_request`; `qa` adds `odt_qa_*`.
- Workflow tool normalization: `packages/core/src/services/odt-workflow-tools.ts`.
- Agent Studio root: `packages/frontend/src/pages/agents/agents-page.tsx`.
- Agent Studio orchestration: `use-agent-studio-*.ts` hooks.
- Runtime and session orchestration: `packages/frontend/src/state/operations/use-agent-orchestrator-operations.ts`.
- Do not rename an `odt_*` tool or change a role allowlist in one layer.
- Update MCP, core, adapters, host, and frontend code in the same change.

## Tests

### Coverage

- Add deep tests for changed non-frontend behavior in `packages/host`, `packages/core`, adapters, and MCP.
- Add frontend tests for changed frontend behavior.
- Run the checks that cover each changed area before you finish.
- NEVER change a production API, constructor, option, or exported type only to make a test easier or faster.
- Use a narrow test helper, a local fake around an existing boundary, or a refactor that improves the production design.

### Bun module mocks

- NEVER mock a shared re-export barrel such as `@/state`, `@/components`, or another `index.ts` module.
- Mock the source module that owns the export, such as `@/state/app-state-provider`.
- Register `mock.module(...)` in scoped setup only when you need a module seam.
- Prefer dependency injection, a direct function parameter, or `spyOn`.
- NEVER keep `mock.module(...)` active for the life of a file through `beforeAll` and `afterAll`.
- Account for Bun interleaving test files in one process.
- Scope a module mock to the smallest test span and restore it at once.
- NEVER use `mock.restore()` to clean up `mock.module(...)`.
- Do not remove mocks from other tests through process-wide cleanup.
- After `mock.module(...)`, restore the exact module ID by remocking it to the real module or by using an equivalent exact-ID cleanup.
- Do not leave a module mock active after its test scope.
- If one file needs the real implementation while another file keeps a module mock, remock the exact module ID to the real implementation or import the real module through an isolated path.
- Do not use a process-wide restore.
- NEVER load the real module through the mocked specifier while the mock is active.
- Capture the real module before the mock, or restore it from a source path that is not mocked.
- Match the exact import string that the production code uses.
- A mock for `./bar` does not replace `@/foo/bar`.
- If production code imports a dependency through a relative path or other non-barrel specifier, mock that exact import string.
- Do not mock only an upstream alias or barrel.

### Test isolation

- Do not mutate `host`, a shared query client, an exported adapter, or another module-level singleton when a local seam can replace it.
- If no local seam exists, restore the mutation in `finally` or `afterEach`.
- Prefer dependency injection or hook parameters over module mocks for code that uses host adapters, TanStack Query hooks, or app-state hooks.
- If a hook test needs one app-state selector or one host read, mock that exact hook or function instead of a larger provider or store graph.
- Give each test that uses TanStack Query its own isolated query client.
- Use `QueryProvider` with `useIsolatedClient`.
- Do not use the app-global query client or cache state from another test.
- Provide the smallest required context providers when a test uses an app-state hook such as `useWorkspaceState`.
- A `renderToStaticMarkup` test needs the same required providers as a client-rendered test when the component uses Query or context state.
- If a test only checks that one dependency receives the correct input, use a focused hook test with an injected fake instead of a component-level module mock.
- Prefer a focused hook or module test over a broad page test for orchestration or routing behavior.
- Avoid broad page tests with React Query, routers, and heavy module mocks because they can leak handles and stop the Bun runner.
- Return new nested objects and arrays from each fixture.
- Do not share mutable nested data between tests.

### Async and flaky tests

- Treat a short default polling window as unsafe in CI.
- For async query work or portal and render scheduling, use an explicit timeout with `waitFor(...)` or the test harness wait helper.
- Keep each explicit wait timeout below the Bun test timeout.
- Run flake checks in sequence.
- Do not run local flake checks in parallel because they can compete for the same Bun test process resources and hide the cause of a leak.

### Browser validation

- Use `agent-browser` against the live app and real OpenDucktor backend for browser end-to-end checks.
- Use browser mode as the default UI validation path when browser automation can cover the change.
- Do not start `bun run browser:dev`.
- Ask the user to start `bun run browser:dev`, then connect to the running app.

## Documentation

- Write project prose in ASD-STE100 Simplified Technical English.
- Keep code, command names, paths, schema fields, and other exact technical terms unchanged.
- Use sentence case for headings.
- Use active voice, one idea per sentence, and short common words when they keep the exact meaning.
- Put each Markdown paragraph and list item on one physical line.
- State facts, rules, steps, and completion checks.
- Remove sales language, filler, stock AI phrases, and vague claims.
- Do not use em dashes, decorative emojis, or bold text as decoration.
- Keep one source for each rule.
- Link to branch-specific details instead of copying them into this file.

## Finish

- Run the checks that cover the changed code or documents.
- Run GitNexus `detect_changes()` before you commit.
- Use a Conventional Commit.
