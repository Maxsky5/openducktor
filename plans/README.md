# React improvement plans

Audit baseline: commit `38620ea0f` on `fix/improve-react`.

These plans were produced by the read-only `/improve-react` workflow. Each plan is self-contained and must be implemented against the stamped commit. If source code has materially drifted, stop and refresh the plan rather than improvising.

## Recommended execution order

| Order | Plan | Severity | Category | Status | Dependencies | Why this order |
|---:|---|---|---|---|---|---|
| 1 | [004 — Secure Markdown external-link handling](004-secure-markdown-external-links.md) | HIGH | Security | TODO | None | Closes a privileged Electron navigation boundary with an existing validated API. |
| 2 | [010 — Break the app-state provider import cycle](010-break-app-state-import-cycle.md) | MEDIUM | Maintainability & architecture | TODO | None | Small, low-risk structural cleanup before broader state work. |
| 3 | [005 — Name the message composer](005-name-message-composer.md) | HIGH | Accessibility | TODO | None | Small primary-control accessibility fix required by plan 008. |
| 4 | [006 — Name the compact workflow menu](006-name-compact-workflow-menu.md) | HIGH | Accessibility | TODO | None | Independent, focused recurring-control accessibility fix. |
| 5 | [001 — Make composer refs commit-safe](001-commit-safe-composer-refs.md) | HIGH | Bugs & correctness | TODO | None | Corrects the hottest composer render-purity path before autocomplete semantics change. |
| 6 | [002 — Purify live transcript overlay updates](002-purify-live-transcript-overlay.md) | HIGH | Bugs & correctness | TODO | None | Corrects streaming state consistency and subscription input ownership. |
| 7 | [003 — Debounce composer file searches](003-debounce-composer-file-search.md) | HIGH | Performance | TODO | None | Establishes the final reference-popup timing used by plan 008. |
| 8 | [008 — Wire composer autocomplete as a combobox](008-wire-composer-combobox-accessibility.md) | MEDIUM | Accessibility | TODO | 003, 005 | Depends on the settled hidden/loading interval and the approved composer name. |
| 9 | [009 — Make workspace branch identity commit-safe](009-commit-safe-workspace-branch-identity.md) | MEDIUM | Bugs & correctness | TODO | None | Localized lifecycle/race correction with existing concurrency coverage. |
| 10 | [007 — Batch Kanban session-history reads](007-batch-kanban-session-history.md) | MEDIUM | Performance | TODO | None | Largest cross-package change; do after focused plans and verify all structural test ports. |

## Dependency graph

```text
003 ─┐
     ├──> 008
005 ─┘

001, 002, 004, 006, 007, 009, and 010 are independent.
```

Plan 007 has an internal layer order:

```text
contracts
  -> host port and SQLite adapter
  -> task service and command router
  -> host client
  -> frontend TanStack Query module
  -> Kanban consumer
  -> focused integration tests
```

## Status meanings

- `TODO`: approved audit finding; implementation has not started.
- `IN PROGRESS`: an executor is implementing the plan against the stamped commit.
- `DONE`: implementation and all plan verification checks passed.
- `STALE`: source drift invalidated exact excerpts or target steps; rerun `/improve-react reconcile`.
- `RETIRED`: the finding was fixed or superseded by another change without executing this plan.

## Shared execution rules

1. Implement one plan at a time unless the README explicitly allows parallel work.
2. Do not combine unrelated source cleanup with a plan.
3. Follow repository constraints in `AGENTS.md`, especially:
   - no fallback logic that masks failures;
   - TanStack Query owns reusable server reads;
   - no database schema or durable record change without explicit human approval;
   - frontend behavior changes require focused tests;
   - browser validation uses a user-started `bun run browser:dev` session.
4. Run focused verification sequentially, then required package/repository checks.
5. Run React Doctor against the diff and confirm the score does not regress.
6. Before committing, run GitNexus `detect_changes({ scope: "compare", base_ref: "main" })` and review affected flows.
7. Update this table's status only after the plan's complete `Done when` criteria are met.
