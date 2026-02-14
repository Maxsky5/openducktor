# OpenBlueprint V1

OpenBlueprint is a macOS-first Tauri v2 desktop app with a Bun monorepo, React frontend, and Rust host runtime.

## Monorepo Layout

- `apps/desktop`: React + Vite desktop frontend and Tauri host.
- `packages/contracts`: Shared runtime schemas and DTO contracts.
- `packages/core`: Hexagonal domain services and ports.
- `packages/adapters-opencode-sdk`: `AgentEnginePort` adapter.
- `packages/adapters-tauri-host`: Frontend IPC client adapter.
- `packages/ui`: Reusable UI components.

## Hexagonal Boundaries

Replaceable ports:

- `AgentEnginePort` in `/Users/20017260/.codex/worktrees/1317/openblueprint/packages/core/src/ports/agent-engine.ts`
- `TaskStore` trait in `/Users/20017260/.codex/worktrees/1317/openblueprint/apps/desktop/src-tauri/crates/host-domain/src/lib.rs`

Current adapters:

- Opencode adapter: `/Users/20017260/.codex/worktrees/1317/openblueprint/packages/adapters-opencode-sdk/src/index.ts`
- Beads adapter: `/Users/20017260/.codex/worktrees/1317/openblueprint/apps/desktop/src-tauri/crates/host-infra-beads/src/lib.rs`

## Home Config

OpenBlueprint stores config at:

- `~/.openblueprint/config.json`

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

- Base directory: `~/.openblueprint/beads/`
- Per repo store: `~/.openblueprint/beads/<repo-id>/.beads`
- `repo-id`: `<slug>-<short-hash>` derived from canonical absolute repo path

Behavior:

- On repository add/select, OpenBlueprint auto-initializes Beads if needed.
- OpenBlueprint always sets `BEADS_DIR` for `bd` commands.
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

Planner tool surface is intentionally reduced to `set_spec_markdown` only.

## Commands

```bash
bun install
bun run typecheck
bun run build
bun run test

# frontend (browser only)
bun run --filter @openblueprint/desktop dev

# tauri CLI/version
bun run tauri -- --version

# desktop app (frontend + rust host)
bun run tauri:dev

# tauri host rust check only
cd apps/desktop/src-tauri && cargo check
```

## IPC Commands (Implemented)

- `system_check`
- `workspace_list`, `workspace_add`, `workspace_select`
- `workspace_update_repo_config`, `workspace_set_trusted_hooks`
- `tasks_list`, `task_create`, `task_update`, `task_set_phase`
- `spec_get`, `spec_set_markdown`
- `delegate_start`, `delegate_respond`, `delegate_stop`, `delegate_cleanup`
- `runs_list`

Run events emit on `openblueprint://run-event`.
