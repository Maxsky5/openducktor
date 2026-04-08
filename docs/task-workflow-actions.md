# Task Workflow Actions

## Purpose
This document defines the canonical action contract for task-level workflow operations in OpenDucktor.
It complements:
- `docs/task-workflow-status-model.md`
- `docs/task-workflow-transition-matrix.md`

The backend is the single source of truth for which actions are currently allowed for a task.

## Core Rule
- Backend computes `availableActions` for each `TaskCard`.
- Frontend must render actions from `availableActions`.
- Frontend must not infer allowed actions from local status-only heuristics.

## Action Set (Canonical IDs)
- `view_details`
- `set_spec`
- `set_plan`
- `build_start`
- `open_builder`
- `reset_implementation`
- `qa_start`
- `open_qa`
- `defer_issue`
- `resume_deferred`
- `human_request_changes`
- `human_approve`

## Action Semantics

### `view_details`
- Purpose: open task details panel.
- Transition: none.

### `set_spec`
- Purpose: author or revise the specification markdown.
- Transition: `open -> spec_ready`, or stays in place when already `spec_ready` or `ready_for_dev`.

### `set_plan`
- Purpose: author or revise implementation plan markdown.
- Transition:
  - `feature/epic`: allowed from `spec_ready` and `ready_for_dev` (`ready_for_dev` remains `ready_for_dev`).
  - `task/bug`: allowed from `open`, `spec_ready`, and `ready_for_dev` (`ready_for_dev` remains `ready_for_dev`).

### `build_start`
- Purpose: start build execution for this task.
- Transition: to `in_progress` when allowed by backend transition rules.

### `open_builder`
- Purpose: open existing builder context/run UX.
- Transition: none.

### `reset_implementation`
- Purpose: discard the current implementation attempt and clean up task-owned build/QA state.
- Transition: `in_progress`, `blocked`, `ai_review`, or `human_review` -> derived rollback target.
- Rollback target:
  - `ready_for_dev` when an implementation plan document is retained.
  - `spec_ready` when only a spec document is retained.
  - `open` when neither document is retained.
- Guardrails:
  - reject while live build or QA activity still exists for the task.
  - fail if task-owned branch cleanup is unsafe, including checked-out branches.
  - preserve retained spec and plan documents.

### `qa_start`
- Purpose: request or start a QA review loop for the current task state.
- Transition: none directly; it opens the QA workflow from `ai_review` or `human_review`.

### `open_qa`
- Purpose: open existing QA context/run UX.
- Transition: none.

### `defer_issue`
- Purpose: park a task without closing it.
- Transition: open states -> `deferred`.
- Guardrail: not allowed for subtasks.

### `resume_deferred`
- Purpose: restore deferred task into active workflow.
- Transition: `deferred -> open`.
- Guardrail: not allowed for subtasks.

### `human_request_changes`
- Purpose: human review rejects current output and requests a rework loop.
- Transition: `ai_review -> in_progress` or `human_review -> in_progress`.

### `human_approve`
- Purpose: human review accepts completion.
- Transition: `ai_review -> closed` or `human_review -> closed`.
- Guardrail: epic completion checks direct children and ignores deferred children.

## UI Mapping Guidance
- A task can expose multiple actions at once.
- UI should surface:
  - one primary action (based on product ordering preferences),
  - remaining actions in a secondary menu.
- Primary ordering is a UI concern; allowed action set is backend authority.

## Current UI Scope
Current card/detail primary+menu rendering uses workflow actions:
- `set_spec`
- `set_plan`
- `build_start`
- `open_builder`
- `reset_implementation`
- `qa_start`
- `open_qa`
- `defer_issue`
- `resume_deferred`
- `human_request_changes`
- `human_approve`

`view_details` is handled via card click / details panel affordance and is not shown as a dedicated workflow button.

## Notes For Future Changes
- Add new action IDs only with:
  1. backend action derivation update,
  2. transition-matrix update,
  3. docs update here and in transition/status model docs,
  4. UI mapping update.
