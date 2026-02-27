# Backend God Files Splitting Plan (2026-02-27)

## Objective
Split backend monolith files into focused modules to improve readability, change safety, and test maintainability, while preserving behavior and existing contracts.

## Rust Test Policy (Confirmed)
- Your understanding is correct: in Rust, unit tests are commonly co-located with implementation (`#[cfg(test)] mod tests` in the same module/file).
- We will keep this approach.
- We will not do "test-only relocation" as a standalone task.
- Tests move only when the related implementation is extracted to a new module, and they stay co-located with that module.

## Scope
- Rust backend:
  - `apps/desktop/src-tauri/crates/host-application`
  - `apps/desktop/src-tauri/crates/host-infra-system`
  - `apps/desktop/src-tauri/crates/host-infra-beads`
  - `apps/desktop/src-tauri/src`
- Backend TypeScript:
  - `packages/openducktor-mcp`
  - `packages/adapters-tauri-host`
  - `packages/adapters-opencode-sdk`

## Prioritized Hotspots
1. `apps/desktop/src-tauri/crates/host-application/src/app_service/mod.rs` (`5245` LOC total; ~`893` production + ~`4352` tests).
2. `apps/desktop/src-tauri/src/lib.rs` (`988` LOC; `48` Tauri commands).
3. `apps/desktop/src-tauri/crates/host-infra-system/src/config.rs` (`1051` LOC; mixed types/normalization/migrations/store).
4. `packages/openducktor-mcp/src/odt-task-store.ts` (`901` LOC; multi-responsibility class).
5. `apps/desktop/src-tauri/crates/host-infra-beads/src/store.rs` (`830` LOC; cache + metadata + full task-store behavior).
6. `apps/desktop/src-tauri/crates/host-application/src/app_service/opencode_runtime.rs` (`769` LOC; process/runtime/readiness concerns mixed).
7. `packages/adapters-tauri-host/src/index.ts` (`591` LOC; many command domains in one adapter).
8. `packages/adapters-opencode-sdk/src/opencode-sdk-adapter.ts` (`531` LOC; session + streaming + MCP + model/tool APIs).

## Constraints and Invariants
- Keep hexagonal boundaries from `AGENTS.md`:
  - Port contracts stay in core/domain.
  - Adapters stay replaceable.
- Keep workflow/MCP naming and policies stable:
  - `odt_*` tool names unchanged.
  - Role allowlists unchanged.
- Keep Tauri command registration complete in `tauri::generate_handler!`.
- No user-visible behavior changes as part of split-only PRs.

## Definition of Done
- No target production file remains a "god file" (>500 LOC with multiple concerns).
- Each extracted module has one clear responsibility.
- Public APIs and contracts are unchanged.
- Existing tests pass; new regression tests added where extraction risk is high.

## Execution Plan

### Phase 0: Baseline and Safety Net
1. Freeze baseline:
   - `bun run --filter @openducktor/desktop typecheck`
   - `bun run --filter @openducktor/desktop lint`
   - `bun run --filter @openducktor/desktop test`
   - `cd apps/desktop/src-tauri && cargo check`
   - `cd apps/desktop/src-tauri && cargo test`
2. Create a split checklist per file:
   - existing exports/API signatures
   - behavior-critical tests already covering the file
   - command registrations (for Tauri)
3. Use small PR slices (one hotspot per PR).

### Phase 1: Split `app_service/mod.rs` First
Goal: make `mod.rs` a composition root, not a mixed implementation hub.

Target structure under `app_service/`:
- `mod.rs` (module wiring + minimal `AppService` public surface)
- `service_core.rs` (`AppService` constructor/drop + shared state shape)
- `repo_init.rs` (`repo_key`, repo init cache, ensure initialized)
- `process_registry.rs` (registry file lock/read/normalize/write helpers)
- `startup_metrics.rs` (`OpencodeStartupMetrics*`, payload builders)
- `task_enrichment.rs` (`enrich_task`, `enrich_tasks`)
- keep existing specialized modules (`build_orchestrator`, `opencode_runtime`, `task_workflow`, etc.)

Test handling:
- Keep unit tests co-located with extracted modules.
- Cross-cutting service flow tests may remain in `mod.rs` until naturally split by scenario.

Validation:
- `cd apps/desktop/src-tauri && cargo test -p host-application`
- `cd apps/desktop/src-tauri && cargo check`

### Phase 2: Split Tauri Command Hub (`src-tauri/src/lib.rs`)
Goal: isolate command families while preserving one Tauri entry point.

Target structure under `apps/desktop/src-tauri/src/commands/`:
- `workspace.rs`
- `git.rs`
- `tasks.rs`
- `documents.rs` (`spec/plan/qa` command handlers)
- `build.rs`
- `runtime.rs`
- `agent_sessions.rs`

`lib.rs` keeps:
- bootstrap (`bootstrap_service`, shutdown handler, `run`)
- shared command helpers (`as_error`, `run_service_blocking`, warning namespace helpers)
- `generate_handler!` list

Important:
- Keep every command registered in `generate_handler!`.
- Avoid changing IPC payload shapes.

Validation:
- `bun run --filter @openducktor/desktop test`
- `cd apps/desktop/src-tauri && cargo test`

### Phase 3: Split `host-infra-system/config.rs`
Goal: separate data model, normalization, migrations, and persistence operations.

Target structure under `host-infra-system/src/config/`:
- `mod.rs` (public exports + assembly)
- `types.rs` (`HookSet`, `RepoConfig`, `GlobalConfig`, defaults)
- `normalize.rs` (normalization helpers)
- `migrate.rs` (canonical-key migration logic)
- `store.rs` (`AppConfigStore` load/save/workspace/repo methods)

Test strategy:
- Keep unit tests in each module file.
- Keep migration regression tests with `migrate.rs`.
- Keep high-level store behavior tests with `store.rs`.

Validation:
- `cd apps/desktop/src-tauri && cargo test -p host-infra-system`
- `cd apps/desktop/src-tauri && cargo check`

### Phase 4: Split `host-infra-beads/store.rs`
Goal: separate CLI execution, caching, metadata handling, and TaskStore behaviors.

Target structure under `host-infra-beads/src/store/`:
- `mod.rs` (`BeadsTaskStore` type + thin `TaskStore` impl delegations)
- `bd_client.rs` (`runBd`/`runBdJson` wrappers, init checks)
- `cache.rs` (task list cache state/ttl/invalidation)
- `namespace.rs` (metadata namespace resolution/normalization)
- `task_ops.rs` (list/create/update/delete task operations)
- `doc_ops.rs` (spec/plan/qa metadata operations)
- `session_ops.rs` (agent session metadata operations)

Test strategy:
- Keep unit tests with each operation module.
- Keep black-box integration style tests in `src/tests.rs` where they already provide strong behavioral coverage.

Validation:
- `cd apps/desktop/src-tauri && cargo test -p host-infra-beads`
- `cd apps/desktop/src-tauri && cargo check`

### Phase 5: Split `openducktor-mcp/src/odt-task-store.ts`
Goal: convert large stateful class into a facade over cohesive internals.

Target module split:
- `task-resolution.ts` (index building + task id/title resolution + related errors)
- `bd-runtime-client.ts` (bd process and JSON execution wrappers)
- `metadata-docs.ts` (namespace/doc parsing + write helpers)
- `task-transitions.ts` (transition checks + apply)
- `epic-subtasks.ts` (subtask replacement/create/delete flow)
- `odt-task-store.ts` (small orchestrator/facade)

Constraints:
- Keep tool method behavior and return shapes unchanged (`readTask`, `setSpec`, `setPlan`, etc.).
- Preserve workflow policy interactions.

Validation:
- `bun run --filter @openducktor/openducktor-mcp test`
- `bun run --filter @openducktor/openducktor-mcp typecheck`

### Phase 6: Split Adapter Monoliths

#### 6A) `adapters-tauri-host/src/index.ts`
Target split:
- `invoke-utils.ts` (parse helpers/schema wrappers)
- `task-metadata-cache.ts` (cache + in-flight logic)
- `workspace-client.ts`
- `task-client.ts`
- `git-client.ts`
- `build-runtime-client.ts`
- `index.ts` as facade implementing `PlannerTools`

#### 6B) `adapters-opencode-sdk/src/opencode-sdk-adapter.ts`
Target split:
- `session-registry.ts` (session state + lifecycle)
- `message-ops.ts` (send/reply paths)
- `catalog-and-mcp.ts` (model catalog + tool ids + MCP status/connect)
- `event-emitter.ts` (listener registry + emit helpers)
- `opencode-sdk-adapter.ts` facade

Validation:
- `bun run --filter @openducktor/adapters-tauri-host test`
- `bun run --filter @openducktor/adapters-opencode-sdk test`
- `bun run --filter @openducktor/adapters-tauri-host typecheck`
- `bun run --filter @openducktor/adapters-opencode-sdk typecheck`

### Phase 7: Secondary Rust Candidates
After phases 1-6, reassess and split only if still multi-concern:
- `app_service/opencode_runtime.rs`
- `app_service/workflow_rules.rs`
- `app_service/runtime_orchestrator.rs`
- `app_service/task_workflow.rs`

Rule:
- Skip unnecessary churn if a file becomes cohesive and reasonably sized after upstream extractions.

Validation:
- `cd apps/desktop/src-tauri && cargo test -p host-application`

## PR Slicing Recommendation
1. PR-1: `app_service/mod.rs` split.
2. PR-2: Tauri command hub split.
3. PR-3: `config.rs` split.
4. PR-4: `host-infra-beads/store.rs` split.
5. PR-5: `odt-task-store.ts` split.
6. PR-6: adapter splits.
7. PR-7: optional secondary Rust splits.

Each PR should include:
- no behavior changes,
- focused regression tests for touched module boundaries,
- command/test evidence in PR description.

## Risk Controls
- Keep public signatures stable during extraction.
- Use thin delegator methods first, then move internals incrementally.
- After each extraction step, run package/crate-local tests before continuing.
- Preserve serialization shapes (`serde` and zod schemas) during refactors.

## Acceptance Checklist
- [x] All hotspot files split per plan or intentionally deferred with rationale.
- [x] Rust unit tests remain co-located with implementation modules.
- [x] No Tauri commands dropped from `generate_handler!`.
- [x] MCP/Workflow contracts unchanged (`odt_*`, role policy).
- [x] Required checks pass:
  - [x] `bun run typecheck`
  - [x] `bun run lint`
  - [x] `bun run test`
  - [x] `cd apps/desktop/src-tauri && cargo check`
  - [x] `cd apps/desktop/src-tauri && cargo test`
  - [x] `cd apps/desktop/src-tauri && cargo test -p host-application --lib`
  - [x] `cd apps/desktop/src-tauri && cargo test -p host-infra-system --lib`

## Phase 7 Reassessment
- `app_service/opencode_runtime.rs`, `app_service/workflow_rules.rs`, `app_service/runtime_orchestrator.rs`, and `app_service/task_workflow.rs` remain above 500 LOC but are now single-domain modules after upstream splits.
- Additional splitting was intentionally deferred to avoid churn without clear cohesion gain.
