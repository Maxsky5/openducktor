# Task workflow transition matrix

This matrix lists every allowed task transition. The backend validates it. The UI cannot set a status directly. A workflow tool or task action must start each automatic transition.

`task_transition` cannot move a task to `blocked` or `closed`. Use the corresponding workflow tool or task action.

## Workflow tools

- `odt_read_task`: `taskId`
- `odt_read_task_assets`: `taskId`, `assetIds`
- `odt_read_task_documents`: `taskId`, `includeSpec?`, `includePlan?`, `includeQaReport?`
- `odt_set_spec`: `taskId`, `markdown`
- `odt_set_plan`: `taskId`, `markdown`, `subtasks?`
- `odt_build_blocked`: `taskId`, `reason`
- `odt_build_resumed`: `taskId`
- `odt_build_completed`: `taskId`, `summary?`
- `odt_set_pull_request`: `taskId`, `providerId`, `number`
- `odt_qa_approved`: `taskId`, `reportMarkdown`
- `odt_qa_rejected`: `taskId`, `reportMarkdown`

Call `odt_read_task` first for the returned `task` summary object, including task state, `qaVerdict`, and document presence booleans.

When task Markdown contains `odt-asset:<assetId>` images needed for the work, collect the relevant IDs and call `odt_read_task_assets` once when their raw total is at most 20 MiB. Split only larger sets.

Call `odt_read_task_documents` only when spec, implementation plan, or latest QA markdown bodies are needed.

An epic `subtasks` item has a required `title`, an optional `description`, an `issueType` of `task`, `feature`, or `bug`, and a `priority` from 0 through 4. The defaults are `task` and 2. Children can have one level only.

Human actions are `human_request_changes(taskId, note)` and `human_approve(taskId)`. Native task actions are `reset_implementation(taskId)`, `reset_task(taskId)`, and `close_task(taskId)`.

## Matrix

| Trigger | From | Guard | To |
|---|---|---|---|
| `task_create` | none | Always. | `open` |
| `odt_set_spec` | `open`, `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | Markdown is not empty. | `spec_ready` from `open`; otherwise unchanged. |
| `odt_set_plan` (feature/epic) | `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | Markdown is not empty. | `ready_for_dev` from `spec_ready`; otherwise unchanged. |
| `odt_set_plan` (task/bug) | `open`, `spec_ready`, `ready_for_dev`, `in_progress`, `blocked`, `ai_review`, `human_review` | Markdown is not empty. | `ready_for_dev` from `open` or `spec_ready`; otherwise unchanged. |
| `odt_set_plan` (epic with subtasks) | Same as epic plan. | Replacement requires all current direct children to be `open`, `spec_ready`, or `ready_for_dev`. | Same as epic plan. |
| `odt_build_resumed` for `feature` or `epic` | `ready_for_dev`, `blocked` | Standard flow or blocked resume. | `in_progress` |
| `odt_build_resumed` for `task` or `bug` | `open`, `spec_ready`, `ready_for_dev`, `blocked` | Optional short flow or blocked resume. | `in_progress` |
| `odt_build_blocked` | `in_progress`, `ai_review`, `human_review` | `reason` is not empty. | `blocked` |
| `odt_build_blocked` | `blocked` | `reason` is not empty. Idempotent. No write runs. | Unchanged. |
| `reset_implementation` | `in_progress`, `blocked`, `ai_review`, `human_review` | No live build or QA activity. Branch cleanup is safe. | `ready_for_dev`, `spec_ready`, or `open` from retained documents. |
| `reset_task` | Any non-closed status. | No live role activity. Branch cleanup is safe. | `open` |
| `odt_build_completed` | `in_progress`, `blocked` | QA is required and the latest result is not `approved`. | `ai_review` |
| `odt_build_completed` | `in_progress`, `blocked` | QA is not required, or the latest result is `approved`. | `human_review` |
| `odt_build_completed` | `ai_review`, `human_review` | Idempotent. No hook or patch runs. | Unchanged. |
| `odt_set_pull_request` | `in_progress`, `ai_review`, `human_review` | `providerId` and pull request number are present. | Unchanged. |
| `odt_qa_rejected` | `blocked`, `ai_review`, `human_review` | Report Markdown is present. | `in_progress` |
| `odt_qa_approved` | `blocked`, `ai_review`, `human_review` | Report Markdown is present. | `human_review` |
| `human_request_changes` | `ai_review`, `human_review` | `note` is optional. | `in_progress` |
| `human_approve` | `ai_review`, `human_review` | All direct epic children are closed. | `closed` |
| `close_task` | Any non-closed status. | Detail sheet only. No live role activity. Epic children are closed. Cleanup succeeds. | `closed` |

`reset_task` clears documents, linked sessions, delivery data, and in-memory runs. `close_task` stops task dev servers and removes task worktrees and related local branches.

## Invalid examples

- `open -> closed` without `close_task`.
- `ai_review -> closed` without `human_approve` or `close_task`.
- `blocked -> closed` without `close_task`.

UI labels are display text. Analytics and reports use stored status values. `Backlog` means `open`, `Done` means `closed`, and `Blocked needs input` means `blocked`.
