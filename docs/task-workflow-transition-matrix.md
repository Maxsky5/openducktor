# Task workflow transition matrix

This matrix lists every allowed task transition. The backend validates it. The UI cannot set a status directly. A workflow tool or task action must start each automatic transition.

## Workflow tools

| Tool | Inputs |
|---|---|
| `odt_read_task` | `taskId` |
| `odt_read_task_assets` | `taskId`, `assetIds` |
| `odt_read_task_artifacts` | `taskId`, `codes` |
| `odt_set_task_artifact` | `taskId`, `code`, `name?`, `fileName?`, `mediaType?`, `content?`, `dataBase64?`, `verdict?` |
| `odt_delete_task_artifact` | `taskId`, `code` |
| `odt_search_tasks` | `priority?`, `issueType?`, `status?`, `title?`, `tags?`, `limit?` |
| `odt_create_task` | `title`, `issueType`, `priority`, `description?`, `labels?` |
| `odt_update_task` | `taskId`, `title?`, `description?`, `priority?`, `labels?`, `issueType?` |
| `odt_apply_workflow_event` | `taskId`, `eventId`, `note?` |
| `odt_set_pull_request` | `taskId`, `number` |

The browser tools never change task status or artifacts. They are `odt_browser_list`, `odt_browser_open`, `odt_browser_navigate`, `odt_browser_close`, `odt_browser_snapshot`, `odt_browser_click`, `odt_browser_hover`, `odt_browser_type`, `odt_browser_press`, `odt_browser_select`, `odt_browser_scroll`, `odt_browser_screenshot`, `odt_browser_console`, `odt_browser_wait`, and `odt_browser_dialog`. See [External MCP](external-mcp.md#browser-tools).

The public update tool never changes `status` or artifacts.

`odt_apply_workflow_event` sends an event that the task workflow declares for agents. The prompt of a role lists the events of the role. The built-in workflow lets the Builder role send these events:

| `eventId` | Note | Meaning |
|---|---|---|
| `build-blocked` | Required. It gives the reason. | Move the task to `blocked`. |
| `build-resumed` | Optional. | Move a blocked task back to `in_progress`. |
| `build-completed` | Optional. It summarizes the result. | Move the task to `ai_review` or `human_review`. |

The host checks the event against the task workflow and the role of the calling session. The host does not store the note. It returns the note in the result.

Call `odt_read_task` first for task fields, `workflowArtifacts`, and an `artifacts` metadata array of all current workflow and free artifacts.

When task Markdown contains `odt-asset:<assetId>` images needed for the work, collect the relevant IDs and call `odt_read_task_assets` once when their raw total is at most 20 MiB. Split only larger sets.

Then call `odt_read_task_artifacts` with a nonempty array of distinct `codes` from `task.artifacts`. For example, `{ "taskId": "repo-123", "codes": ["spec"] }` returns the full spec. The built-in workflow declares the codes `spec`, `plan`, and `qaReport`; free artifacts have their own stable codes. Each read returns the complete content or fails. Internal artifact IDs remain within the UI and store.

Human actions are `human_request_changes(taskId, feedback)` and `human_approve(taskId)`. `human_approve` is the `approval` action of the workflow, and it opens the approval modal. The core task actions of every workflow are `reset_task(taskId)` and `close_task(taskId, removeWorktree)`. No workflow event controls them. The approval outcomes and pull request management are also core rules. `reset_implementation(taskId)` is an event action whose event has the `worktree.reset` host effect. The core task action `remove_worktree(taskId)` removes the kept worktree of a closed task.

Free-artifact creation, rename, replacement, and deletion require a non-closed task. They preserve task status, QA verdict, and workflow readiness. The setter routes workflow codes through the existing workflow actions and enforces managed role access. Delete rejects workflow codes. Manual Specification and Implementation Plan saves keep status unchanged, including on closed tasks.

## Matrix

A trigger such as `build-completed` is an event that `odt_apply_workflow_event` sends.

| Trigger | From | Guard | To |
|---|---|---|---|
| `task_create` | none | Always. | `open` |
| `odt_set_task_artifact`, code `spec` | `open`, `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | Markdown is not empty. | `spec_ready` from `open`; otherwise unchanged. |
| `odt_set_task_artifact`, code `plan` (feature) | `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | Markdown is not empty. | `ready_for_dev` from `spec_ready`; otherwise unchanged. |
| `odt_set_task_artifact`, code `plan` (task/bug) | `open`, `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | Markdown is not empty. | `ready_for_dev` from `open` or `spec_ready`; otherwise unchanged. |
| `build-resumed` for `feature` | `ready_for_dev`, `blocked` | Standard flow or blocked resume. | `in_progress` |
| `build-resumed` for `task` or `bug` | `open`, `spec_ready`, `ready_for_dev`, `blocked` | Optional short flow or blocked resume. | `in_progress` |
| `build-resumed` | `ai_review`, `human_review` | Rework. | `in_progress` |
| `build-resumed` | `in_progress` | Idempotent. No write runs. | Unchanged. |
| `build-blocked` | `in_progress`, `ai_review`, `human_review` | `note` is not empty. | `blocked` |
| `build-blocked` | `blocked` | `note` is not empty. Idempotent. No write runs. | Unchanged. |
| `reset_implementation` | `in_progress`, `blocked`, `ai_review`, `human_review` | No live build or QA activity. Branch cleanup is safe. | `ready_for_dev`, `spec_ready`, or `open` from retained artifacts. |
| Core `reset_task` | Any status except `closed`. | No live role activity. Branch cleanup is safe. | `open`. An `open` task stays `open` and is cleared. |
| `build-completed` | `in_progress`, `blocked` | The latest QA result is not `approved`. | `ai_review` |
| `build-completed` | `in_progress`, `blocked` | The latest QA result is `approved`. | `human_review` |
| `build-completed` | `ai_review`, `human_review` | Idempotent. No hook or patch runs. | Unchanged. |
| `odt_set_pull_request` | Any status except `closed`. | A pull request number is present and the repository has a configured provider. | Unchanged. |
| `odt_set_task_artifact`, code `qaReport`, verdict `rejected` | `blocked`, `ai_review`, `human_review` | Report Markdown is present. | `in_progress` |
| `odt_set_task_artifact`, code `qaReport`, verdict `approved` | `blocked`, `ai_review`, `human_review` | Report Markdown is present. | `human_review` |
| `human_request_changes` | `ai_review`, `human_review` | The feedback goes to the Builder launch. | `in_progress` |
| `human_request_changes` | `in_progress` | The action is not available, so the host rejects the event. | Unchanged. |
| `human_approve` | `ai_review`, `human_review` | Opens the approval modal. | Unchanged. |
| Core `close_task` | Any status. | No live role activity. Cleanup succeeds. | `closed`. A `closed` task stays unchanged and no cleanup runs. |
| Core `remove_worktree` | `closed` | No live role activity. Cleanup succeeds. | Unchanged. |
| Core local direct merge | `ai_review`, `human_review` | The approval is available. Merge and cleanup succeed. | `closed` |
| Core direct merge with a publish target | `ai_review`, `human_review` | The approval is available. Merge succeeds. Publication remains pending. | Unchanged. |
| Core complete direct merge | Any status. | Publication and cleanup succeed. | `closed`. A `closed` task stays unchanged. |
| Core link or sync of a merged pull request | Any status except `closed`. | Provider confirms the merge. Cleanup succeeds. | `closed` |

While a recorded local direct merge waits for its publication, the host rejects every workflow event and `reset_task`. Complete the direct merge, use `close_task`, or use `reset_implementation`.

`reset_task` clears all workflow and free artifacts, linked sessions, delivery data, and in-memory runs. `close_task` stops task terminals. It removes task worktrees and related local branches when `removeWorktree` is `true`. `remove_worktree` stops task terminals, then removes task worktrees and related local branches.

## Invalid examples

- `open -> closed` without `close_task`.
- `ai_review -> closed` without `close_task`, a direct merge, or a merged pull request.
- `blocked -> closed` without `close_task`.

UI labels are display text. Analytics and reports use stored status values. `Backlog` means `open`, `Done` means `closed`, and `Blocked needs input` means `blocked`.
