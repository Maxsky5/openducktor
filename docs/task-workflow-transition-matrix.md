# Task Workflow Transition Matrix

## Purpose
This document defines the only allowed lifecycle transitions for OpenDucktor tasks,
including trigger tools/actions and guardrails.

## Transition Policy
- Backend owns transition validation.
- UI cannot directly set arbitrary status values.
- Auto-transitions are triggered only by explicit workflow tools/actions.

## Tool Naming (Canonical)
MCP workflow tools:
- `odt_read_task(taskId)`
- `odt_read_task_documents(taskId, includeSpec?, includePlan?, includeQaReport?)`
- `odt_set_spec(taskId, markdown)`
- `odt_set_plan(taskId, markdown, subtasks?)` (epic only for `subtasks`, one level max)
- `odt_build_blocked(taskId, reason)`
- `odt_build_resumed(taskId)`
- `odt_build_completed(taskId, summary?)`
- `odt_set_pull_request(taskId, providerId, number)`
- `odt_qa_approved(taskId, reportMarkdown)`
- `odt_qa_rejected(taskId, reportMarkdown)`

Read flow:
- Call `odt_read_task` first for the returned `task` summary object, including task state, `qaVerdict`, and document presence booleans.
- Call `odt_read_task_documents` only when spec, implementation plan, or latest QA markdown bodies are needed.

`subtasks` payload (optional):
- `title` (required)
- `issueType` (`task` | `feature` | `bug`, defaults to `task`)
- `priority` (0..4, defaults to `2`)
- `description` (optional)

Human actions:
- `human_request_changes(taskId, note)`
- `human_approve(taskId)`
- `defer_issue(taskId, reason?)`
- `resume_deferred(taskId)`

Native task actions:
- `reset_implementation(taskId)`
- `reset_task(taskId)`

## Transition Matrix
| Trigger | From | Guards | To |
|---|---|---|---|
| `task_create` | n/a | always | `open` |
| `odt_set_spec` | `open`, `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | non-empty markdown | `spec_ready` when starting from `open`, otherwise unchanged |
| `odt_set_plan` (feature/epic) | `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | non-empty markdown | `ready_for_dev` when starting from `spec_ready`, otherwise unchanged |
| `odt_set_plan` (task/bug) | `open`, `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | non-empty markdown | `ready_for_dev` when starting from `open` or `spec_ready`, otherwise unchanged |
| `odt_set_plan` (epic with subtasks) | `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | plan includes subtask proposals; replacing existing direct subtasks requires all direct subtasks to be `open`, `spec_ready`, or `ready_for_dev` | `ready_for_dev` when starting from `spec_ready`, otherwise unchanged |
| `odt_build_resumed` | `ready_for_dev` | feature/epic standard flow | `in_progress` |
| `odt_build_resumed` | `open`, `spec_ready`, `ready_for_dev`, `blocked` | task/bug optional flow + blocked resume | `in_progress` |
| `odt_build_blocked` | `in_progress` | reason required | `blocked` |
| `reset_implementation` | `in_progress`, `blocked`, `ai_review`, `human_review` | reject while live build/QA activity exists; reject on unsafe branch cleanup; retained plan/spec determine rollback target | `ready_for_dev`, `spec_ready`, or `open` |
| `reset_task` | `open`, `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | reject while live spec/planner/build/QA activity exists; reject on unsafe branch cleanup; clear workflow documents, linked sessions, delivery metadata, and in-memory runs | `open` |
| `odt_build_completed` | `in_progress` | `qaRequired=true` and latest QA verdict is not `approved` (including no QA verdict yet) | `ai_review` |
| `odt_build_completed` | `in_progress` | `qaRequired=false` or latest QA verdict is `approved` | `human_review` |
| `odt_build_completed` | `blocked` | `qaRequired=true` and latest QA verdict is not `approved` (including no QA verdict yet) | `ai_review` |
| `odt_build_completed` | `blocked` | `qaRequired=false` or latest QA verdict is `approved` | `human_review` |
| `odt_build_completed` | `ai_review`, `human_review` | idempotent no-op (no hooks, no transition patch) | unchanged |
| `odt_set_pull_request` | `in_progress`, `ai_review`, `human_review` | provider id and PR number required; OpenDucktor resolves canonical PR metadata | unchanged |
| `odt_qa_rejected` | `ai_review`, `human_review` | report markdown required | `in_progress` |
| `odt_qa_approved` | `ai_review`, `human_review` | report markdown required | `human_review` |
| `human_request_changes` | `ai_review`, `human_review` | note optional | `in_progress` |
| `human_approve` | `ai_review`, `human_review` | epic completion guard passes | `closed` |
| `defer_issue` | `open`, `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | not subtask | `deferred` |
| `resume_deferred` | `deferred` | not subtask | `open` |

## Guardrails
- Epic completion guard: block close if direct children are still open states.
- Epic completion guard ignores deferred direct children.
- Only epics can have direct children.
- Subtasks cannot have children.
- Subtasks cannot be deferred via OpenDucktor actions.

## Invalid Transition Examples
- `open -> closed` without human approval.
- `ai_review -> closed` without an explicit `human_approve` action.
- `blocked -> closed` directly.
- `deferred -> in_progress` directly (must resume to `open` first).

## Board Semantics
UI labels are presentation only:
- `Backlog` is persisted as `open`.
- `Done` is persisted as `closed`.
- `Blocked needs input` is persisted as `blocked`.

Any analytics/reporting must use persisted statuses, not UI labels.
