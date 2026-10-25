# Task workflow transition matrix

This matrix lists every allowed task transition. The backend validates it. The UI cannot set a status directly. A workflow tool or task action must start each automatic transition.

## Workflow tools

| Tool | Inputs |
|---|---|
| `odt_read_task` | `taskId` |
| `odt_read_task_assets` | `taskId`, `assetIds` |
| `odt_read_task_artifacts` | `taskId`, `codes`, `byteOffset?`, `maxBytes?`, `expectedVersion?` |
| `odt_set_task_artifact` | `taskId`, `code`, `name?`, `fileName?`, `mediaType?`, `content?`, `dataBase64?`, `verdict?` |
| `odt_delete_task_artifact` | `taskId`, `code` |
| `odt_search_tasks` | `priority?`, `issueType?`, `status?`, `title?`, `tags?`, `limit?` |
| `odt_create_task` | `title`, `issueType`, `priority`, `description?`, `labels?` |
| `odt_update_task` | `taskId`, `title?`, `description?`, `priority?`, `labels?`, `issueType?` |
| `odt_build_blocked` | `taskId`, `reason` |
| `odt_build_resumed` | `taskId` |
| `odt_build_completed` | `taskId`, `summary?` |
| `odt_set_pull_request` | `taskId`, `number` |

The browser tools never change task status or artifacts. They are `odt_browser_list`, `odt_browser_open`, `odt_browser_navigate`, `odt_browser_close`, `odt_browser_snapshot`, `odt_browser_click`, `odt_browser_hover`, `odt_browser_type`, `odt_browser_press`, `odt_browser_select`, `odt_browser_scroll`, `odt_browser_screenshot`, `odt_browser_console`, `odt_browser_wait`, and `odt_browser_dialog`. See [External MCP](external-mcp.md#browser-tools).

The public update tool never changes `status` or artifacts.

Call `odt_read_task` first for task fields, `workflowArtifacts`, and an `artifacts` metadata array of all current workflow and free artifacts.

When task Markdown contains `odt-asset:<assetId>` images needed for the work, collect the relevant IDs and call `odt_read_task_assets` once when their raw total is at most 20 MiB. Split only larger sets.

Then call `odt_read_task_artifacts` with a nonempty array of distinct `codes` from `task.artifacts`. For example, `{ "taskId": "repo-123", "codes": ["spec"] }` returns the full spec. The built-in workflow declares the codes `spec`, `plan`, and `qaReport`; free artifacts have their own stable codes. Free-artifact reads default to 16 KiB. Continued reads require one selected code and the version returned by the first read. Internal artifact IDs remain within the UI and store.

Human actions are `human_request_changes(taskId, note)` and `human_approve(taskId)`. Native task actions are `reset_implementation(taskId)`, `reset_task(taskId)`, and `close_task(taskId)`.

Free-artifact creation, rename, replacement, and deletion require a non-closed task. They preserve task status, QA verdict, and workflow readiness. The setter routes workflow codes through the existing workflow actions and enforces managed role access. Delete rejects workflow codes. Manual Specification and Implementation Plan saves keep status unchanged, including on closed tasks.

## Matrix

| Trigger | From | Guard | To |
|---|---|---|---|
| `task_create` | none | Always. | `open` |
| `odt_set_task_artifact`, code `spec` | `open`, `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | Markdown is not empty. | `spec_ready` from `open`; otherwise unchanged. |
| `odt_set_task_artifact`, code `plan` (feature) | `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | Markdown is not empty. | `ready_for_dev` from `spec_ready`; otherwise unchanged. |
| `odt_set_task_artifact`, code `plan` (task/bug) | `open`, `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | Markdown is not empty. | `ready_for_dev` from `open` or `spec_ready`; otherwise unchanged. |
| `odt_build_resumed` for `feature` | `ready_for_dev`, `blocked` | Standard flow or blocked resume. | `in_progress` |
| `odt_build_resumed` for `task` or `bug` | `open`, `spec_ready`, `ready_for_dev`, `blocked` | Optional short flow or blocked resume. | `in_progress` |
| `odt_build_resumed` | `ai_review`, `human_review` | Rework. | `in_progress` |
| `odt_build_resumed` | `in_progress` | Idempotent. No write runs. | Unchanged. |
| `odt_build_blocked` | `in_progress`, `ai_review`, `human_review` | `reason` is not empty. | `blocked` |
| `odt_build_blocked` | `blocked` | `reason` is not empty. Idempotent. No write runs. | Unchanged. |
| `reset_implementation` | `in_progress`, `blocked`, `ai_review`, `human_review` | No live build or QA activity. Branch cleanup is safe. | `ready_for_dev`, `spec_ready`, or `open` from retained artifacts. |
| `reset_task` | Any non-closed status. | No live role activity. Branch cleanup is safe. | `open` |
| `odt_build_completed` | `in_progress`, `blocked` | The latest QA result is not `approved`. | `ai_review` |
| `odt_build_completed` | `in_progress`, `blocked` | The latest QA result is `approved`. | `human_review` |
| `odt_build_completed` | `ai_review`, `human_review` | Idempotent. No hook or patch runs. | Unchanged. |
| `odt_set_pull_request` | `in_progress`, `ai_review`, `human_review` | A pull request number is present and the repository has a configured provider. | Unchanged. |
| `odt_set_task_artifact`, code `qaReport`, verdict `rejected` | `blocked`, `ai_review`, `human_review` | Report Markdown is present. | `in_progress` |
| `odt_set_task_artifact`, code `qaReport`, verdict `approved` | `blocked`, `ai_review`, `human_review` | Report Markdown is present. | `human_review` |
| `human_request_changes` | `ai_review`, `human_review` | `note` is optional. | `in_progress` |
| `human_request_changes` | `in_progress` | Idempotent. No write runs. The action is not offered. | Unchanged. |
| `human_approve` | `ai_review`, `human_review` | Always. | `closed` |
| `human_approve` | `closed` | No cleanup or write runs. | Unchanged. |
| `close_task` | Any non-closed status. | Detail sheet only. No live role activity. Cleanup succeeds. | `closed` |
| Local direct merge | `ai_review`, `human_review` | Merge and cleanup succeed. | `closed` |
| Direct merge with a publish target | `ai_review`, `human_review` | Merge succeeds. Publication remains pending. | `human_review` |
| Complete direct merge | `ai_review`, `human_review` | Publication and cleanup succeed. | `closed` |
| Link or sync a merged pull request | `ai_review`, `human_review` | Provider confirms the merge. Cleanup succeeds. | `closed` |

`reset_task` clears all workflow and free artifacts, linked sessions, delivery data, and in-memory runs. `close_task` stops task terminals and removes task worktrees and related local branches.

## Invalid examples

- `open -> closed` without `close_task`.
- `ai_review -> closed` without `human_approve` or `close_task`.
- `blocked -> closed` without `close_task`.

UI labels are display text. Analytics and reports use stored status values. `Backlog` means `open`, `Done` means `closed`, and `Blocked needs input` means `blocked`.
