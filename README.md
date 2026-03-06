# OpenDucktor V1

OpenDucktor is a macOS-first Tauri v2 desktop app with a Bun monorepo, React frontend, and Rust host runtime.

## Monorepo Layout

- `apps/desktop`: React + Vite desktop frontend and Tauri host.
- `packages/contracts`: Shared runtime schemas and DTO contracts.
- `packages/core`: Hexagonal domain services and ports.
- `packages/adapters-opencode-sdk`: `AgentEnginePort` adapter.
- `packages/adapters-tauri-host`: Frontend IPC client adapter.

## Hexagonal Boundaries

Replaceable ports:

- `AgentEnginePort` in `packages/core/src/ports/agent-engine.ts`
- `TaskStore` trait in `apps/desktop/src-tauri/crates/host-domain/src/store.rs` (re-exported by `apps/desktop/src-tauri/crates/host-domain/src/lib.rs`)

Current adapters:

- Opencode adapter: `packages/adapters-opencode-sdk/src/index.ts`
- Beads adapter: `apps/desktop/src-tauri/crates/host-infra-beads/src/lib.rs`

## Architecture Docs

- End-to-end architecture and runtime data flow: [docs/architecture-overview.md](docs/architecture-overview.md)
- Agent orchestrator internals: [docs/agent-orchestrator-module-map.md](docs/agent-orchestrator-module-map.md)
- Workflow lifecycle/status contract: [docs/task-workflow-status-model.md](docs/task-workflow-status-model.md)
- Workflow actions: [docs/task-workflow-actions.md](docs/task-workflow-actions.md)
- Workflow transition matrix: [docs/task-workflow-transition-matrix.md](docs/task-workflow-transition-matrix.md)

## Home Config

OpenDucktor stores config at:

- `~/.openducktor/config.json`

Example:

```json
{
  "version": 1,
  "activeRepo": "/abs/path/repo-a",
  "repos": {
    "/abs/path/repo-a": {
      "worktreeBasePath": "/abs/path/outside/repo-a",
      "branchPrefix": "obp",
      "trustedHooks": true,
      "hooks": {
        "preStart": ["bun install --frozen-lockfile"],
        "postComplete": ["bun run test", "bun run lint"]
      }
    }
  },
  "recentRepos": ["/abs/path/repo-a"],
  "scheduler": {
    "softGuardrails": {
      "cpuHighWatermarkPercent": 85,
      "minFreeMemoryMb": 2048,
      "backoffSeconds": 30
    }
  }
}
```

## Beads Storage Policy (V1)

Beads storage is centrally managed per repository and is not user-configurable in V1.

- Base directory: `~/.openducktor/beads/`
- Per repo store: `~/.openducktor/beads/<repo-id>/.beads`
- `repo-id`: `<slug>-<short-hash>` derived from canonical absolute repo path

Behavior:

- On repository add/select, OpenDucktor auto-initializes Beads if needed.
- OpenDucktor always sets `BEADS_DIR` for `bd` commands.
- Existing repo-local `.beads` is ignored in V1 (no migration yet).

## Planner Rules

Spec markdown is canonical in Beads task `description`.

Required sections:

1. `Purpose`
2. `Problem`
3. `Goals`
4. `Non-goals`
5. `Scope`
6. `API / Interfaces`
7. `Risks`
8. `Test Plan`

Task document commands are `spec_get`, `set_spec`, `spec_save_document`, `plan_get`, `set_plan`, and `plan_save_document`.

## Commands

```bash
bun install
bun run typecheck
bun run build
bun run test
bun run deps:check
bun run deps:audit:hono
bun run deps:unused
bun run deps:outdated

# frontend (browser only)
bun run --filter @openducktor/desktop dev

# tauri CLI/version
bun run tauri -- --version

# desktop app (frontend + rust host)
bun run tauri:dev

# tauri host rust check only
cd apps/desktop/src-tauri && cargo check
```

## Dependency Hygiene

- All-in-one blocking hygiene check: `bun run deps:check`
- Included unused dependency check: `bun run deps:unused:deps`
- Included high/critical advisory gate: `bun run deps:audit:high`
- Included targeted vulnerability check (Hono GHSA-`xh87-mx6m-69f3`): `bun run deps:audit:hono`
- Non-blocking unused export report: `bun run deps:unused`
- Outdated dependency report: `bun run deps:outdated`
- Automated update PRs: `.github/dependabot.yml`
- Dedicated CI automation: `.github/workflows/dependency-hygiene.yml`
- Review and upgrade cadence: `docs/dependency-hygiene.md`
- MCP runtime transport and threat assumptions: `docs/mcp-runtime-security.md`

## IPC Commands (Implemented)

- Runtime/system:
  - `system_check`, `runtime_check`, `beads_check`
- Workspace/config:
  - `workspace_list`, `workspace_add`, `workspace_select`
  - `workspace_update_repo_config`, `workspace_save_repo_settings`, `workspace_update_repo_hooks`
  - `workspace_prepare_trusted_hooks_challenge`, `workspace_get_repo_config`, `workspace_set_trusted_hooks`
- Git:
  - `git_get_branches`, `git_get_current_branch`, `git_switch_branch`
  - `git_create_worktree`, `git_remove_worktree`, `git_push_branch`
- Tasks:
  - `tasks_list`, `task_create`, `task_update`, `task_delete`
  - `task_transition`, `task_defer`, `task_resume_deferred`
- Documents/workflow:
  - `spec_get`, `task_metadata_get`, `set_spec`, `spec_save_document`
  - `plan_get`, `set_plan`, `plan_save_document`
  - `qa_get_report`, `qa_approved`, `qa_rejected`
  - `build_start`, `build_respond`, `build_stop`, `build_cleanup`
  - `build_blocked`, `build_resumed`, `build_completed`
  - `human_request_changes`, `human_approve`
- Runs/runtimes:
  - `runs_list`
  - `opencode_runtime_list`, `opencode_runtime_start`, `opencode_runtime_stop`, `opencode_repo_runtime_ensure`
- Agent sessions:
  - `agent_sessions_list`, `agent_session_upsert`
- Theme:
  - `get_theme`, `set_theme`

Run events emit on `openducktor://run-event`.
