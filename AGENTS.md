# AGENTS.md

## Project

OpenDucktor is a Bun monorepo. It contains an Electron desktop app and a local browser runner for AI planning and build workflows. A workspace-scoped SQLite task store is the source of truth for tasks.

Use Bun and `bun run`. Do not use npm or Yarn.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and command details.

## Hard rules

### Expose failures

- Fix failures in the source layer.
- Return or propagate an error that tells the user what to do.
- Do not add fallback logic, a second probe, or an alternate path that hides a failure.
- Do not poll or retry data that must come from an existing live event stream or subscription.

### Keep code simple

- Keep the main path direct.
- Add normalization or extra checks only for a known case.
- Add defensive code only when a clear risk requires it.

### Verify runtime behavior

- Inspect runtime source or an official contract before you change an adapter that depends on external runtime behavior.
- Do not infer available runtime behavior from memory or an adapter shape.

### Protect durable data

- Get human approval before you change a database schema, migration file, persisted record schema, or durable SQLite task-store record shape.
- Stop and ask for approval when a change needs new persisted data or a durable storage change.

## Monorepo map

- `apps/electron`: Electron desktop shell, renderer startup, preload bridge, packaging, and IPC transport.
- `packages/frontend`: Shared React and Vite UI.
- `packages/contracts`: Shared runtime schemas and IPC contracts.
- `packages/core`: Core domain services and ports.
- `packages/host`: Effect-native TypeScript host, command routing, use cases, and infrastructure adapters.
- `packages/adapters-opencode-sdk`: `AgentEnginePort` adapter.
- `packages/host-client`: Frontend IPC adapter.
- `packages/openducktor-mcp`: MCP server for `odt_*` workflow tools.

## Architecture

- Define ports in core or domain code.
- Put adapters in infrastructure code.
- Use an existing contract instead of coupling UI code to infrastructure code.
- Change `packages/contracts` before the host or frontend code that uses a data contract.

### Effect

Read [docs/effect.md](docs/effect.md) before you change a host port, service, adapter, lifecycle, or typed error.

- Return `Effect.Effect<Success, Failure, Requirements>` from host ports and services that perform I/O or can fail.
- Keep Promise interop at transport and external package boundaries.
- Model expected failures as typed errors in the Effect error channel.
- Keep public Zod schemas in `packages/contracts`.

### Runtimes

Read [docs/runtime-integration-guide.md](docs/runtime-integration-guide.md) before you change a runtime, route, session, history, capability, prompt, approval, or catalog.

- Keep runtime definitions, routes, and connections separate.
- Keep live route data out of persisted session records and documents.
- Resolve the route for the selected session or build at the adapter call boundary.
- Do not use the repository default runtime as a fallback for a selected session or build.

## Frontend

Read [docs/frontend-guidelines.md](docs/frontend-guidelines.md) before you change frontend state, forms, components, or themes.

Read [docs/tanstack-query-cache-strategy.md](docs/tanstack-query-cache-strategy.md) before you add or change a frontend read from the host or backend.

- Use TanStack Query for server-owned reads.
- Keep transient UI state and live event streams outside TanStack Query.
- Use existing shadcn components and semantic theme tokens.
- Make each UI change work in light and dark themes.

## Task data and workflow

- Treat the SQLite task store as the only source of truth for tasks.
- Store only durable task and workflow state in task records.
- Rebuild live state from the runtime, event stream, or runtime history.
- Read the applicable `docs/task-workflow-*.md` file before you change a task state or action.

## Host

- Keep host command APIs typed and schema-validated.
- Return actionable typed errors for expected host failures.
- Keep blocking work off the UI thread.
- Reuse known repository readiness. Do not repeat costly repository setup.

## MCP and Agent Studio

Read [docs/external-mcp.md](docs/external-mcp.md) before you change the MCP package, host bridge, workspace scope, or public task tools.

Read [docs/agent-orchestrator-module-map.md](docs/agent-orchestrator-module-map.md) before you change Agent Studio orchestration.

- Keep `ODT_TOOL_SCHEMAS` and `AGENT_ROLE_TOOL_POLICY` consistent.
- Update MCP, core, adapters, host, and frontend code together when a shared workflow tool or role policy changes.

## Tests

Read [docs/testing.md](docs/testing.md) before you add or change tests.

- Add deep tests for changed host, core, adapter, and MCP behavior.
- Add frontend tests for changed frontend behavior.
- Keep production APIs independent from test-only needs.

## Documentation

- Write project prose in ASD-STE100 Simplified Technical English.
- Keep exact code, command, path, schema, and API terms unchanged.
- Use sentence case, active voice, one idea per sentence, and one physical line per Markdown paragraph or list item.
- Remove sales language, filler, stock AI phrases, vague claims, decorative bold text, emojis, and em dashes.
- Keep one source for each rule and link to branch-specific details.

## Finish

Run every full repository check before you complete any change:

```sh
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

Use a Conventional Commit.
