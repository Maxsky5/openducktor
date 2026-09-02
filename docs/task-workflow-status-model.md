# Task workflow status model

This document defines persisted task status, UI labels, issue type rules, and task document ownership.

## Source of truth

- The persisted `status` is the task lifecycle state.
- The backend validates each transition.
- The frontend renders the actions in `TaskCard.availableActions`. It does not infer actions from status.
- User fields and agent documents have separate owners.

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

## Issue types

The UI supports `epic`, `feature`, `task`, and `bug`. It does not support `chore` or `decision`.

`feature` and `epic` use this path:

```text
open -> spec_ready -> ready_for_dev -> in_progress -> ai_review/human_review -> closed
```

They cannot plan from `open`. A later spec or plan edit does not change a task that is already in `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, or `human_review`.

`task` and `bug` can skip the spec and plan:

```text
open -> in_progress
```

## QA defaults

`qaRequired` defaults to `true` for all four issue types.

When `qaRequired` is `true`, build completion moves to `ai_review` until the latest QA result is `approved`. When it is `false`, or QA already approved the current work, build completion moves to `human_review`.

## Epic rules

- Only an `epic` can have direct children.
- The hierarchy has one child level.
- A child cannot have children.
- An epic cannot close while a direct child is not `closed`.

## Task documents

Store agent-written output as task documents, not user task fields. SQLite stores plain Markdown and an explicit `format`.

| Kind | Current UI read |
|---|---|
| `spec` | Latest entry. |
| `implementationPlan` | Latest entry. |
| `qaReports` | Latest entry. |

The store can keep history. Each row has a task ID, kind, revision, Markdown body, format, optional QA result, source tool, updater, and update time. Frontend and MCP reads return plain Markdown.

```json
[
  { "kind": "spec", "sourceTool": "odt_set_spec" },
  { "kind": "implementationPlan", "sourceTool": "odt_set_plan" },
  { "kind": "qaReports", "sourceTool": "odt_qa_approved" }
]
```

Each write must keep unrelated durable task fields. Workflow rules use stored status, not UI labels.
