# packages/

## Responsibility
Workspace-level shared code: shared frontend, contracts, core domain services, TypeScript host boundaries, runtime adapters, browser launcher, and MCP tooling.

## Design Patterns
- Contracts-first boundaries keep runtime descriptors, config/session schemas, slash-command catalogs, and host payloads stable before adapters consume them.
- Hexagonal core and host packages keep runtime/session/approval-policy and host-command logic behind ports while adapters translate host APIs at the edge.
- Frontend, browser, and MCP packages own their own UI, launcher, and bridge surfaces instead of sharing shell internals.
- Adapter event-stream handling is split so OpenCode message normalization lives under `packages/adapters-opencode-sdk/src/event-stream/message-events/` while session-level routing stays in `session-events.ts`.

## Data & Control Flow
`packages/frontend` owns shell-neutral UI composition. `packages/contracts` defines runtime, config/settings, git, session, run, and workflow schemas plus descriptors; `packages/core` defines ports and orchestration rules; `packages/host` defines the transport-neutral TypeScript host command and event boundary, including migrated filesystem, workspace settings, runtime definition/status reads, OpenCode workspace runtime startup, Codex stdio app-server runtime startup and transport registration, persisted agent-session stop routing through runtime registry session abort/probe operations, runtime-backed activity guards for destructive task cleanup, Codex app-server transport request/drain/respond commands behind an explicit port, runtime CLI diagnostics, Beads repo-store diagnostics with managed attachment/shared-Dolt context resolution, shared-Dolt startup, attachment verification, shared database restore, and repair for task-command execution, task list/get/metadata/create/update/delete/reset/reset-implementation/transition/defer/resume, agent-session upsert and bulk listing, PR detect/upsert/unlink/link-merged/sync metadata workflows, direct-merge start/completion with conflict reporting, publish-sync checks, and builder cleanup, spec/plan document persistence, build-start worktree/runtime bootstrap plus build-block/resume/completed hooks, QA approval/rejection, and human review approval/change-request behavior from Beads metadata, task-delete and task-reset cleanup for dev servers plus related worktrees/branches with an explicit activity-guard port when persisted sessions require live runtime checks, task-owned worktree discovery, dev-server state/process control with terminal events, git reads plus switch branch/create worktree/remove worktree/reset selection/ancestry/direct-merge branch merge/remote refresh/pull branch/push branch/rebase/conflict-abort/commit all behavior, GitHub repository detection, local attachment, and external open-in handlers; `packages/adapters-opencode-sdk` maps OpenCode session/global streams into adapter events with `event-stream/message-events/` decomposition; `packages/host-client` exposes the typed host IPC surface; `packages/openducktor-web` and `packages/openducktor-mcp` handle browser-shell and host-bridge execution paths with CLI/bin package metadata.

## Integration Points
- `@openducktor/contracts`
- `@openducktor/core`
- `@openducktor/host`
- `@openducktor/frontend`
- `@openducktor/web`
- `@openducktor/mcp`
