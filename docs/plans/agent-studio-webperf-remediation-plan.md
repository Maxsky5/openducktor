# Agent Studio Web Performance Remediation Plan

## Objectives

- Make Agent Studio interactions feel immediate (tab switch, agent switch, session switch).
- Decouple urgent UI updates from non-urgent data sync and hydration work.
- Reduce render/layout pressure under streaming chat and heavy session histories.
- Establish scalable architecture boundaries so performance remains stable as features grow.

## UX SLAs (Target)

- Tab/agent selection visual response: p95 < 50ms.
- Session switch shell response (header/composer/thread scaffold): p95 < 100ms.
- First meaningful thread content after switch (cached): p95 < 150ms.
- No long main-thread task > 50ms on tab/agent/session switch paths (p95).

## Root Cause -> Remediation Matrix

1. Non-urgent query synchronization was competing with urgent interaction updates.
   - Remediation: schedule query updates in React transition lane from page composition root.
   - Files: `apps/desktop/src/pages/agents-page.tsx`.

2. Page-level derivation was repeatedly scanning and sorting tasks/sessions on each render.
   - Remediation: precompute `tasksById`, `sessionsById`, `sessionsByTaskId`, and latest-session map with memoized one-pass grouping.
   - Files: `apps/desktop/src/pages/agents-page.tsx`.

3. Query context persistence was synchronously writing localStorage on frequent navigation churn.
   - Remediation: dedupe serialized payloads and defer writes to a timeout tick.
   - Files: `apps/desktop/src/pages/use-agent-studio-query-sync.ts`.

4. Scroll trigger changed on every streaming character, causing excessive layout/scroll work.
   - Remediation: bucket draft length updates to reduce autoscroll invalidation frequency.
   - Files: `apps/desktop/src/pages/use-agent-studio-page-models.ts`.

5. Chat thread virtualization performed overlapping measure/scroll effects.
   - Remediation: collapse into a single synchronized virtualized autoscroll effect keyed by pin state + session switch.
   - Files: `apps/desktop/src/components/features/agents/agent-chat/agent-chat-thread.tsx`.

6. Layout hook had duplicate scroll-to-bottom effects.
   - Remediation: unify autoscroll path and keep explicit session repin behavior.
   - Files: `apps/desktop/src/components/features/agents/agent-chat/use-agent-chat-layout.ts`.

7. Thread remounted on every session switch, amplifying mount-side layout work.
   - Remediation: remove thread key remount and let model/session changes drive updates.
   - Files: `apps/desktop/src/components/features/agents/agent-chat/agent-chat.tsx`.

8. Orchestrator session updates always propagated map replacement even for no-op updates.
   - Remediation: add top-level no-op guard before map replace + state set.
   - Files: `apps/desktop/src/state/operations/use-agent-orchestrator-operations.ts`.

9. Session start path blocked on default model retrieval before first visible session state.
   - Remediation: keep model-default loading asynchronous and apply after session shell exists.
   - Files: `apps/desktop/src/state/operations/agent-orchestrator/handlers/start-session.ts`.

10. Session history hydration was oversized and unconstrained in parallelism.
    - Remediation: lower initial history hydration window and add bounded concurrency for hydration batches.
    - Files: `apps/desktop/src/state/operations/agent-orchestrator/lifecycle/load-sessions.ts`.

11. Context usage lookup in model selection scanned model arrays in tight loops.
    - Remediation: pre-index active session model descriptors and compute usage from narrowed dependencies.
    - Files: `apps/desktop/src/pages/use-agent-studio-model-selection.ts`.

12. First send/kickoff could race against async default-model resolution.
    - Remediation: allow deterministic startup model via `selectedModel` injection and add `requireModelReady` gating for first-send flows.
    - Files: `apps/desktop/src/state/operations/agent-orchestrator/handlers/start-session.ts`, `apps/desktop/src/pages/use-agent-studio-session-actions.ts`, `apps/desktop/src/types/state-slices.ts`.

13. Deferred query-context persistence risked dropping the final write on hide/unload.
    - Remediation: flush pending deferred localStorage write on `pagehide` and `visibilitychange` (hidden).
    - Files: `apps/desktop/src/pages/use-agent-studio-query-sync.ts`.

14. Session-switch reset contract needed explicit guarantees after removing thread remount.
    - Remediation: enforce explicit input reset per session id and explicit session-change scroll-anchor reset in chat layout hook.
    - Files: `apps/desktop/src/pages/use-agent-studio-session-actions.ts`, `apps/desktop/src/components/features/agents/agent-chat/use-agent-chat-layout.ts`.

15. Task document metadata was reloaded on every tab revisit, triggering repeated `task_metadata_get` IPC calls.
    - Remediation: cache per-task document snapshots in `useTaskDocuments` and restore cached state on tab/task context switches; keep explicit force-reload paths for freshness.
    - Files: `apps/desktop/src/components/features/task-details/use-task-documents.ts`.

## Implemented in this Change

- [x] Transition-lane query updates from `AgentsPage` orchestration.
- [x] Page-level lookup/grouping memoization to cut repeated scans/sorts.
- [x] Query-sync localStorage write dedupe + deferred persistence.
- [x] Scroll trigger bucketing for streaming drafts.
- [x] Virtualized thread scroll/measure effect consolidation.
- [x] Layout hook autoscroll consolidation and repin simplification.
- [x] Thread remount removal across session switches.
- [x] Orchestrator no-op update guard.
- [x] Deferred default model application in start-session flow.
- [x] Bounded-concurrency history hydration + reduced initial history limit.
- [x] Model descriptor index for context-usage derivation.
- [x] Deterministic first-send startup (`selectedModel` + `requireModelReady`).
- [x] Session-switch reset contract for composer input and scroll anchor.
- [x] Deferred context-persist flush on page lifecycle transitions.
- [x] Per-task document caching to avoid repeated `task_metadata_get` fetches on tab revisits.

## Architecture Evolution (Long-Term, Recommended)

### 1) Split Agent Studio state by urgency

- Urgent UI lane: selection state (`task/session/agent/scenario`), tab focus state, composer input state.
- Non-urgent data lane: session histories, document reloads, model catalogs, warmup metadata.
- Recommended shape:
  - `useAgentStudioSelectionState` (urgent, transition-safe).
  - `useAgentStudioDataState` (async hydration/caching).
  - `useAgentStudioViewModels` (memoized selectors from stable slices).

### 2) Introduce selector-based subscriptions for orchestrator sessions

- Replace broad `sessions` array fan-out with selector hooks (by task/session).
- Maintain normalized store with stable entity references and derived memo selectors.
- Goal: session updates should not force unrelated task tabs/header models to recompute.

### 3) Progressive history hydration protocol

- Keep initial lightweight history on list load.
- Expand history on-demand for the active session only.
- Add explicit “load older messages” affordance when the user scrolls upward.

### 4) Observable performance budgets in CI and dev

- Add marks around tab switch, session switch, and message send/start flows.
- Track long task count and interaction latency in Playwright scenarios.
- Fail performance checks when regressions exceed budget thresholds.

## Validation Plan

1. Run desktop typecheck/lint/tests after implementation.
2. Profile tab/agent/session switch in React Profiler and browser performance panel.
3. Verify no blank-frame delays when changing tabs/agents while sessions/documents are loading.
4. Verify pinned-to-bottom behavior during streaming and after session changes.
5. Verify session history correctness with reduced initial hydration window and bounded batch loading.

## Rollout Notes

- History hydration limit is intentionally reduced for responsiveness; if product requires deeper immediate backlog, add explicit progressive loading controls instead of restoring full eager hydration.
- The current remediation keeps existing contracts and avoids MCP/workflow policy changes.
- Next high-impact scaling step is selector-based orchestrator subscriptions and stricter urgent/non-urgent state boundaries.
