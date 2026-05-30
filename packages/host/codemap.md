# packages/host/

## Responsibility
Transport-neutral TypeScript host for Electron and local browser shells. It exposes a typed command router, host event bus, application use cases, and adapters for git, Beads, runtimes, files, config, and process lifecycle.

## Layer Boundaries
- `src/domain/`: pure business rules. Task policy is split by concern (`status-transition`, `agent-workflow`, `task-action`, `task-branch`, `task-hierarchy`, `task-planning`, and `approval`). No Node APIs, transports, or adapters.
- `src/application/`: use-case orchestration grouped by bounded capability (`tasks`, `git`, `runtimes`, `workspaces`, `dev-servers`, etc.). It coordinates domain rules and ports, but does not import Node APIs.
- `src/interface/commands/`: host-command adapters. This layer parses `Record<string, unknown>` command payloads into typed application inputs.
- `src/interface/router/`: transport-neutral command dispatch.
- `src/ports/`: driven-port contracts implemented by adapters.
- `src/infrastructure/`: infrastructure modules coupled to external command output, filesystem layouts, Beads/Dolt, and git internals.
- `src/infrastructure/process/`: shared Node process, PATH, PATHEXT, command-launch, and process-tree helpers used by infrastructure and adapters.
- `src/adapters/`: adapter implementations grouped by external system or technical concern. Names should describe the external boundary (`git-cli-adapter`, `beads-task-repository`, `runtime-registry`) instead of the runtime platform. No production files should live directly in the adapter root.
- `src/composition/`: process-wide wiring and lifecycle orchestration.

## Current Host Composition
- `src/composition/node/create-node-host-command-router.ts` is the Node composition root. It wires adapters, application services, command handlers, lifecycle shutdown, and event publication.
- `src/application/tasks/task-service.ts` is the task application facade. Concrete task actions live in `src/application/tasks/use-cases/`; shared workflow helpers live in `src/application/tasks/support/`; task sync and worktree coordination have dedicated `sync/` and `worktrees/` modules.
- `src/ports/task-repository-ports.ts` defines the task repository capabilities required by workflow use cases. Capabilities are explicit; application code should not probe for missing repository methods at runtime.
- Runtime orchestration depends on runtime registry, git authorization, runtime definitions, and task metadata reads only.
- System diagnostics depends on runtime health, system commands, settings config, runtime definitions, and repo-store diagnostics only.

## Command Flow
Shell transports invoke `HostCommandRouter.invoke(command, args)`.
Command names and parser live in `src/interface/commands/host-command-registry.ts`.
The router dispatches to handlers in `src/interface/commands/`.
Handlers validate command payloads and call typed application services.
Application services call ports and domain policies.
Adapters implement the ports with git CLI, Beads/Dolt, runtime processes, filesystem/config access, and process-local registries.

## Guardrails
- Fail at the source layer with actionable errors. Do not add fallback probes to hide broken primary behavior.
- Keep application/domain/interface/port files free of Node imports; Node APIs belong in adapters or infrastructure.
- Keep application/domain/interface/port files independent from adapters and infrastructure; dependencies point inward through ports.
- Keep application and adapter files inside named submodules. Do not add production files directly under `src/application/` or `src/adapters/`.
- Use domain/action-oriented task filenames. Do not reintroduce `task-service-*` migration-era support files.
- Keep production host files below the architecture guard thresholds.
- Do not model first-class features as compatibility paths. Default worktree paths are product behavior, not migration fallback.
