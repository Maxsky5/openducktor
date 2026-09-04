# Task workflow actions

The backend returns allowed task actions in `TaskCard.availableActions`. The frontend renders that list. It does not infer actions from status.

Read [the status model](task-workflow-status-model.md) for status and issue type rules. Read [the transition matrix](task-workflow-transition-matrix.md) for all transition guards.

## Action IDs

- `view_details`
- `set_spec`
- `set_plan`
- `build_start`
- `open_builder`
- `reset_implementation`
- `reset_task`
- `qa_start`
- `open_qa`
- `close_task`
- `human_request_changes`
- `human_approve`

## Simple actions

| Action | Effect |
|---|---|
| `view_details` | Open task details. No transition. |
| `build_start` | Move to `in_progress` when backend rules allow it. |
| `open_builder` | Open the linked Builder session. No transition. |
| `qa_start` | Open QA from `blocked`, `ai_review`, or `human_review`. No direct transition. |
| `open_qa` | Open the linked QA session. No transition. |
| `human_request_changes` | Move `ai_review` or `human_review` to `in_progress`. |
| `human_approve` | Move `ai_review` or `human_review` to `closed` after the epic child check passes. |

## Document actions

`set_spec` writes or revises the specification. From `open`, it moves the task to `spec_ready`. In any other allowed status, it changes only the document.

`set_plan` writes or revises the implementation plan. A `feature` or `epic` can use it from `spec_ready` or any later active status. A `task` or `bug` can also use it from `open`. Valid planning before a build moves the task to `ready_for_dev`. A later edit changes only the document.

For an epic, `subtasks` means replace the direct child proposal. Replacement is allowed only when all current direct children are `open`, `spec_ready`, or `ready_for_dev`. If `subtasks` is absent, keep the current children.

## Reset implementation

`reset_implementation` discards the current build and QA attempt. It can run from `in_progress`, `blocked`, `ai_review`, or `human_review`.

Choose the target from the documents that remain:

- Use `ready_for_dev` when the plan remains.
- Use `spec_ready` when only the specification remains.
- Use `open` when neither remains.

Before the reset:

- Reject the action while a live task role uses the canonical worktree.
- Check the canonical worktree and task branch.
- Restore tracked files to the local base. Remove ordinary untracked files and keep ignored files.
- Keep the canonical worktree, task branch, specification, and plan. Do not rerun copy paths or hooks.

## Reset task

`reset_task` moves any non-closed task to `open`. It keeps the task ID and user fields.

It clears workflow documents, linked role sessions, pull request data, direct merge data, and in-memory runs. It stops task dev servers, then removes task worktrees and related local branches.

Reject the action while a live role still owns task state. Reject it when branch cleanup is unsafe, such as when another worktree has the branch checked out.

## Close task

`close_task` moves any non-closed task to `closed` from the task detail sheet. It is an administrative override.

The action keeps the task record, user fields, documents, QA reports, session history, pull request data, and direct merge data. It stops task dev servers and removes managed worktrees and local branches. If cleanup is unsafe or incomplete, it fails with an error.

Reject it while a live role owns mutable task state. Reject an epic while a direct child is not closed.

Only the task detail sheet can show `close_task`. Do not show it on a Kanban card, Agent Studio quick action, bulk action, header, or command palette.

## UI rules

A task can have more than one action. The UI can choose one primary action and put the rest in a menu. Display order is a UI rule. The backend list remains the authority.

Current card and detail views use all action IDs except `view_details`, which the card click and details panel already provide.

When you add an action ID, update backend derivation, the transition matrix, the status and action docs, and UI mapping in one change.
