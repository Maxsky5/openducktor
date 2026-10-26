# Task workflow status model

This document defines persisted task status, UI labels, issue type rules, and task artifact ownership.

## Source of truth

- The persisted `status` is the task lifecycle state.
- The backend validates each transition.
- The frontend renders the actions in `TaskCard.availableActions`. It does not infer actions from status.
- User fields and task artifacts have separate owners.

## Statuses

| Stored status | UI label | Note |
|---|---|---|
| `open` | Backlog | Persisted backlog state. |
| `spec_ready` | Spec Ready | The task has a specification. |
| `ready_for_dev` | Ready for Dev | The task can start a build. |
| `in_progress` | In Progress | Build work is active or can resume. |
| `blocked` | Blocked needs input | Build work needs input. |
| `ai_review` | AI Review | QA can review the build. |
| `human_review` | Human Review | This still counts as work in progress for orchestration. |
| `closed` | Done | The task is closed. |

`close_task` is an administrative override. It does not prove that code was merged, QA passed, or all workflow steps finished.

The sidebar excludes sessions for `closed` tasks. If the visible task closes, the Sessions page returns to Kanban. Closing a task keeps its saved session history.

## Issue types

The built-in workflow has the issue types `feature`, `task`, and `bug`.

`feature` uses this path:

```text
open -> spec_ready -> ready_for_dev -> in_progress -> ai_review/human_review -> closed
```

They cannot plan from `open`. A later spec or plan edit does not change a task that is already in `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, or `human_review`.

`task` and `bug` can skip the spec and plan:

```text
open -> in_progress
```

## QA review

QA review is part of the workflow for every task. Build completion moves to `ai_review` until the latest QA result is `approved`. When the latest stored QA result is already `approved`, build completion moves to `human_review`.

## Task artifacts

Store saved outputs as task artifacts. The task workflow definition declares its workflow artifacts. The built-in workflow declares the Specification (`spec`), Implementation Plan (`plan`), and QA Report (`qaReport`). Free artifacts contain other files and do not affect workflow readiness or task status. Description images remain separate. See [task artifacts](task-artifacts.md) for collection, preview, and download rules.

### Role handoffs

| Role | Owns |
|---|---|
| Spec | User problem, scope, required behavior, observable outcomes, and constraints. Clarifies unresolved product decisions with the user. |
| Planner | Technical design, module responsibilities, architecture boundaries, interfaces, and data and state contracts. |
| Builder | Implementation details, work order, tests, and verification within the required outcomes and design contracts. |
| QA | Independent review of outcomes, contracts, correctness, and maintainability, with checks based on risk. |

Spec and Planner save complete artifacts with `odt_set_task_artifact` and codes `spec` and `plan` once required decisions are resolved. Builder and QA work from the saved requirements and design contracts. Later workflow artifact revisions follow the [transition matrix](task-workflow-transition-matrix.md).

See [workflow prompts](runtime-integration-guide.md#workflow-prompts) for template ownership, versions, and overrides.

### Storage

The `tasks_artifacts` table stores workflow history and the current version of each free artifact. Artifact discovery returns metadata for the latest existing workflow revision and every free artifact. Task cards expose workflow presence in `artifactSummary` without file bodies.

| Classification | Identity | Content | Revisions |
|---|---|---|---|
| Workflow | Task ID and artifact code. | Markdown text with `plain_text` format. | Append a row for each revision. |
| Free | Generated artifact ID. | Exact file bytes, filename, media type, and byte size. | Keep one row and increment revision on change. |

Workflow rows store the public artifact code, such as `spec`, `plan`, or `qaReport`, and the ID `workflow:<taskId>:<code>`. Each row keeps its source command, writer, update time, and optional review verdict. A new row records `odt_set_task_artifact` or `workflow_artifact_save` as `sourceTool`, and the writer role or `user` as `updatedBy`. Rows from before migration 0009 keep their earlier `sourceTool` values.

A free artifact can contain up to 10 MiB. Its display name never selects a workflow role. Replacement keeps its identity and display name. Closed tasks retain all artifacts but reject free-artifact changes.

The forward migration copies every workflow revision from `task_documents` into `tasks_artifacts` and then drops `task_documents` in the same transaction. All hosts that share an upgraded workspace must use the new schema. Downgrade requires a compatible database backup.

Each write must keep unrelated durable task fields. Workflow rules use stored status, not UI labels.
