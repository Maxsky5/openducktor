# Task Workflow Transition Matrix

## Purpose
This document defines the only allowed lifecycle transitions for OpenDucktor tasks,
including trigger tools/actions and guardrails.

## Transition Policy
- Backend owns transition validation.
- UI cannot directly set arbitrary status values.
- Auto-transitions are triggered only by explicit workflow tools/actions.

## Tool Naming (Canonical)
Planner tools:
- `set_spec(taskId, markdown)`
- `set_plan(taskId, markdown, subtasks?)` (epic only for `subtasks`, one level max)

`subtasks` payload (optional):
- `title` (required)
- `issueType` (`task` | `feature` | `bug`, defaults to `task`)
- `priority` (0..4, defaults to `2`)
- `description` (optional)

Builder tools:
- `build_start(taskId)`
- `build_blocked(taskId, reason)`
- `build_resumed(taskId)`
- `build_completed(taskId, summary)`

QA tools:
- `qa_approved(taskId, reportMarkdown)`
- `qa_rejected(taskId, reportMarkdown)`

Human actions:
- `human_request_changes(taskId, note)`
- `human_approve(taskId)`
- `defer_issue(taskId, reason?)`
- `resume_deferred(taskId)`

## Transition Matrix
| Trigger | From | Guards | To |
|---|---|---|---|
| `task_create` | n/a | always | `open` |
| `set_spec` | `open`, `spec_ready` | non-empty markdown | `spec_ready` |
| `set_plan` | `spec_ready`, `open` | non-empty markdown | `ready_for_dev` |
| `set_plan` (epic) | `spec_ready`, `open` | plan includes subtask proposals | `ready_for_dev` |
| `build_start` | `ready_for_dev` | feature/epic standard flow | `in_progress` |
| `build_start` | `open`, `spec_ready`, `ready_for_dev` | task/bug optional flow | `in_progress` |
| `build_blocked` | `in_progress` | reason required | `blocked` |
| `build_resumed` | `blocked` | resume requested | `in_progress` |
| `build_completed` | `in_progress` | `qaRequired=true` | `ai_review` |
| `build_completed` | `in_progress` | `qaRequired=false` | `human_review` |
| `qa_rejected` | `ai_review` | report markdown required | `in_progress` |
| `qa_approved` | `ai_review` | report markdown required | `human_review` |
| `human_request_changes` | `human_review` | note optional | `in_progress` |
| `human_approve` | `human_review` | epic completion guard passes | `closed` |
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
- `ai_review -> closed` without QA approval + human approval.
- `blocked -> closed` directly.
- `deferred -> in_progress` directly (must resume to `open` first).

## Board Semantics
UI labels are presentation only:
- `Backlog` is persisted as `open`.
- `Done` is persisted as `closed`.
- `Blocked needs input` is persisted as `blocked`.

Any analytics/reporting must use persisted statuses, not UI labels.
