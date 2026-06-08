# Workflow Core

- Beads is V1 task source of truth. Lifecycle state is Beads `status`, not labels/phases.
- Canonical statuses: built-in `open`, `in_progress`, `blocked`, `deferred`, `closed`; custom `spec_ready`, `ready_for_dev`, `ai_review`, `human_review`.
- UI label mapping: `open` is Backlog, `closed` is Done, `deferred` is hidden from Kanban.
- Beads metadata stores durable task/workflow state only. Never serialize pending permissions, pending questions, live runtime routes, in-progress transcripts, tool streaming state, or other live-only recoverable values.
- Agent-authored docs live under Beads metadata namespace `openducktor.documents`: `spec`, `implementationPlan`, `qaReports` latest-only.
- Task action schema is `packages/contracts/src/task-schemas.ts` (`taskActionSchema`). Detailed docs are `docs/task-workflow-actions.md`, `docs/task-workflow-status-model.md`, and `docs/task-workflow-transition-matrix.md`.
- Agent Studio root is `packages/frontend/src/pages/agents/agents-page.tsx`; orchestration lives in `use-agent-studio-*.ts` hooks and `packages/frontend/src/state/operations/use-agent-orchestrator-operations.ts`.
- Read-only roles (`spec`, `planner`, `qa`) must keep mutating permission auto-rejection.
- Do not rename or partially update `odt_*` workflow tools. MCP, core policy, adapter, and frontend tool surfaces must move together.