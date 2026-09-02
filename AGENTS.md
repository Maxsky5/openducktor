# AGENTS.md

## Project

OpenDucktor is a Bun monorepo. It has an Electron desktop app and a local browser runner. Both run AI planning and build workflows. A workspace-scoped SQLite task store is the source of truth for tasks.

Use Bun. Run workspace commands with `bun run`. Do not use npm or Yarn.

## Work rules

- Fix a failure at the source that caused it. Return an error that tells the user what to do.
- Keep the main path direct. Do not add a fallback, second probe, silent default, or retry that hides a failed contract.
- Use an existing event stream or subscription for live data. Fix that contract instead of adding a polling loop.
- Keep the code simple. Add normalization or extra checks only when a known case needs them.
- Inspect runtime source or an official contract before you change an adapter that depends on runtime behavior.
- Ask for human approval before you change a database schema, migration, persisted record schema, or durable SQLite task-store shape.

## Code map

- `apps/electron` contains the Electron shell, renderer startup, preload bridge, packaging, and IPC transport.
- `packages/frontend` contains the shared React and Vite UI.
- `packages/contracts` contains shared runtime schemas and IPC contracts.
- `packages/core` contains domain services and ports.
- `packages/host` contains the Effect-native TypeScript host, command routing, use cases, and infrastructure adapters.
- `packages/adapters-opencode-sdk` implements `AgentEnginePort` for OpenCode.
- `packages/host-client` adapts host IPC for the frontend.
- `packages/openducktor-mcp` exposes the `odt_*` workflow tools.

## Architecture

- Define ports in core or domain code. Put adapters in infrastructure code.
- Use an existing contract instead of coupling UI code to infrastructure code.
- Change `packages/contracts` before you change host or frontend code that uses a data contract.

### Effect in the host

Read [docs/effect.md](docs/effect.md) before you change a host port, service, adapter, lifecycle, or typed error.

- A host port or service that performs I/O or can fail returns `Effect.Effect<Success, Failure, Requirements>`.
- Keep Promise interop at Electron IPC, browser HTTP/SSE, shell bridges, and external APIs that require Promise values.
- Model expected failures as typed errors. Prefer `Data.TaggedError`. Do not use `throw new Error(...)` for an expected host failure.
- Use `Effect.gen` for steps. Use `Context.Tag` and `Layer` when they make dependency wiring clear. Use `Effect.try` and `Effect.tryPromise` at external boundaries.
- Use `catchAll`, retry, fallback, or a default only when the product contract calls for that behavior. Use Effect schedules for an explicit retry or polling policy.
- Keep pure policy code synchronous when it has no I/O and no useful typed failure channel.
- Keep public Zod schemas in `packages/contracts`. Do not create a second public schema source with Effect Schema.
- TanStack Query owns the frontend cache for server-owned reads. Effect code must not add another cache for the same data.

### Runtime boundaries

- Treat runtime definitions, runtime routes, and runtime connections as separate layers.
- Keep shared host-visible runtime and run payloads in `packages/contracts/src/run-schemas.ts`.
- Keep `RuntimeInstanceSummary` limited to `kind`, `runtimeId`, `repoPath`, nullable `taskId`, `role`, `workingDirectory`, `runtimeRoute`, `startedAt`, and `descriptor`. Do not add top-level `endpoint`, `port`, or duplicate `capabilities` fields.
- Keep `runtimeId` and `runtimeRoute` in the runtime registry and adapters. UI and orchestration code carry `runtimeKind`, repository path, working directory, and session ID.
- Pass `runtimeConnection` objects to request-scoped agent engine operations. Build adapter-specific client input at the adapter boundary.
- Persist durable IDs and `workingDirectory`. Do not store `runtimeEndpoint`, `baseUrl`, `runtimeTransport`, or other live route data in session records or documents.
- Resolve the route for the selected session or build. Do not fall back to the repository default runtime for history, todos, diff, or file status.
- Define runtime capabilities in `packages/contracts/src/agent-runtime-schemas.ts`. Do not copy capability flags to runtime instance summaries.

## Frontend

- Wire state contexts in `packages/frontend/src/state/app-state-provider.tsx`.
- Put domain operations in focused hooks under `packages/frontend/src/state/{lifecycle,operations,tasks}`.
- Use operation-specific flags such as `isLoadingTasks` and `isLoadingChecks`.
- Put shared types in `packages/frontend/src/types`. Put feature constants in `constants.ts`.
- During an async form submission, disable the full form, show loading in the submit button, and keep error or success feedback visible.
- Replace nested ternaries with named booleans, helper functions, lookup maps, or `if` statements.

### TanStack Query

Read [docs/tanstack-query-cache-strategy.md](docs/tanstack-query-cache-strategy.md) before you add or change a frontend read from the host or backend.

- Use TanStack Query for server-owned data that can be reused, refreshed, invalidated, or deduplicated.
- Define query keys and option builders in a focused module under `packages/frontend/src/state/queries`.
- Use `useQuery`, `useQueries`, or `useSuspenseQuery` for backend data read during render.
- Use `queryClient.fetchQuery`, `ensureQueryData`, `prefetchQuery`, or cache invalidation for an imperative read.
- After a mutation, update or invalidate each cache entry that the mutation changed.
- Derive UI state from query results. Copy data only when the copy is a user-editable draft.
- Keep transient UI state, form drafts, modal state, live transcripts, tool output, and pending permission or question state outside TanStack Query.
- Keep a provider API stable when only its read path must move to TanStack Query.

### Theme and components

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

- Hardcoded colors may mark status, Kanban lane themes, or small badges and tags.
- Use light status backgrounds and dark status text. Include dark-theme classes.
- Do not use a gradient for a surface or component.
- Apply semantic tokens with `className` at the use site. Do not change a base shadcn component to add hardcoded colors.
- Use components from `packages/frontend/src/components/ui` when one exists.

## Host and task store

- Keep host command APIs typed and schema-validated.
- Return actionable typed errors for expected host failures.
- Keep blocking work off the UI thread.
- Reuse known repository readiness. Do not repeat costly setup.
- Treat the SQLite task store as the only source of truth for tasks.
- Store only durable task and workflow state in task records.
- Rebuild pending permissions, questions, runtime routes, transcripts, and tool streams from the live runtime, event stream, or runtime history. Do not persist them in the task store.
- Find task actions in `packages/contracts/src/task-schemas.ts`. Read `docs/task-workflow-*.md` before you change a task state or action.

## MCP and Agent Studio contract

Change all affected layers together when you change this contract.

| Part | Source |
|---|---|
| Server name | `openducktor` |
| Tool schemas | `ODT_TOOL_SCHEMAS` in `packages/openducktor-mcp/src/lib.ts` |
| Workflow tools | `odt_read_task`, `odt_read_task_assets`, `odt_read_task_documents`, `odt_set_spec`, `odt_set_plan`, `odt_build_blocked`, `odt_build_resumed`, `odt_build_completed`, `odt_set_pull_request`, `odt_qa_approved`, and `odt_qa_rejected` |
| Role policy | `AGENT_ROLE_TOOL_POLICY` in `packages/core/src/types/agent-orchestrator.ts` |
- All roles can call the three read tools. `spec` adds `odt_set_spec`. `planner` adds `odt_set_plan`. `build` adds `odt_build_*` and `odt_set_pull_request`. `qa` adds `odt_qa_*`.
- Normalize tools in `packages/core/src/services/odt-workflow-tools.ts`.
- Agent Studio starts in `packages/frontend/src/pages/agents/agents-page.tsx` and its `use-agent-studio-*.ts` hooks.
- Runtime and session orchestration lives in `packages/frontend/src/state/operations/use-agent-orchestrator-operations.ts`.

Do not rename an `odt_*` tool or change a role allowlist in one layer. Update MCP, core, adapters, host, and frontend code in the same change.

## Tests

- Add deep tests for changed non-frontend behavior in `packages/host`, `packages/core`, adapters, and MCP.
- Add frontend tests for changed frontend behavior.
- Keep production APIs, constructors, options, and exported types independent from test needs. Use a local fake, dependency injection, or a test helper around an existing boundary.
- Prefer a direct function parameter or `spyOn` over `mock.module(...)`.

### Bun module mocks

- Mock the source module that owns an export. Do not mock a shared barrel such as `@/state`, `@/components`, or another `index.ts` file.
- Match the exact import string used by production code. A mock for `./bar` does not replace `@/foo/bar`.
- Scope `mock.module(...)` to the smallest test span. Bun can interleave files in one process, so a file-wide module mock can leak to another suite.
- Restore the exact module ID by remocking it to a real module captured before the mock. You can instead load the real module through a path that was not mocked.
- Do not use `mock.restore()` to clean up `mock.module(...)`. It acts on the whole process and can remove mocks from another test.

### Test isolation

- Give each TanStack Query test an isolated query client. Use `QueryProvider` with `useIsolatedClient`.
- Add the smallest required context providers when a test uses an app-state hook such as `useWorkspaceState`. This rule also applies to `renderToStaticMarkup` tests.
- Do not mutate `host`, a shared query client, an exported adapter, or another singleton when a local seam can replace it. If no local seam exists, restore the value in `finally` or `afterEach`.
- Return new nested objects and arrays from each fixture. Do not share mutable nested data across tests.
- Use a focused hook or module test for routing and orchestration rules. Use a broad page test only when the page integration is the behavior under test.

### Async and flaky tests

- Give async query, portal, and render waits an explicit timeout. Keep each wait shorter than the Bun test timeout.
- Run flake checks in sequence. Parallel Bun runs can hide a shared-process leak or cause a false failure.

### Browser validation

Use `agent-browser` against the live app and real OpenDucktor backend for browser end-to-end checks. Ask the user to start `bun run browser:dev`. Do not start it yourself.

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

Run a focused workspace test with this form:

```sh
bun run --filter @openducktor/frontend test
```

## Documentation

- Write project prose in ASD-STE100 Simplified Technical English. Keep code, command names, paths, schema fields, and other exact technical terms unchanged.
- Use sentence case for headings. Use one idea per sentence. Prefer active voice and short words.
- Put each Markdown paragraph and list item on one physical line.
- State facts, rules, steps, and completion checks. Remove sales language, filler, stock AI phrases, and vague claims.
- Do not use em dashes, decorative emojis, or bold text as decoration.
- Keep one source for each rule. Link to branch-specific details instead of copying them into this file.

## Finish

- Run the checks that cover the changed code or documents.
- Use a Conventional Commit.
