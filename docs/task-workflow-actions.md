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
| `build_start` | Start Builder and move `open`, `spec_ready`, or `ready_for_dev` to `in_progress` when backend rules allow it. Keep later statuses unchanged. |
| `open_builder` | Open the linked Builder session. No transition. |
| `qa_start` | Open QA from `blocked`, `ai_review`, or `human_review`. No direct transition. |
| `open_qa` | Open the linked QA session. No transition. |
| `human_request_changes` | Move `ai_review` or `human_review` to `in_progress`. |
| `human_approve` | Move `ai_review` or `human_review` to `closed` after the epic child check passes. |

## Session startup

Spec, Planner, Builder, and QA sessions use the canonical task worktree directory. An existing directory must be a registered worktree of the workspace repository. It must not resolve to the repository root.

Session startup accepts any branch or detached HEAD in that worktree. It keeps the current branch and files. If the worktree does not exist, startup creates it with the configured task branch name and runs the configured copy paths and hooks.

## Document actions

`set_spec` writes or revises the specification. From `open`, it moves the task to `spec_ready`. In any other allowed status, it changes only the document.

`set_plan` writes or revises the implementation plan. A `feature` or `epic` can use it from `spec_ready` or any later active status. A `task` or `bug` can also use it from `open`. Valid planning before a build moves the task to `ready_for_dev`. A later edit changes only the document.

For an epic, `subtasks` means replace the direct child proposal. Replacement is allowed only when all current direct children are `open`, `spec_ready`, or `ready_for_dev`. If `subtasks` is absent, keep the current children.

## Direct merge

Stop all running sessions for the task before direct merge or its completion. The host checks every linked role session before it changes Git. While either operation runs, the host rejects task session starts, resumes, forks, and new messages.

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

Only the task detail sheet can show `close_task`. Do not show it on a Kanban card, Task Workflows quick action, bulk action, header, or command palette.

## Merged pull requests

Pull request sync records the merged pull request, stops task terminals and dev servers, and removes the task worktree and local source branch before it closes the task. If cleanup fails, the task keeps its current status and the host reports the error.

A successful dev server stop clears its process ownership and records `stopped` before terminal cleanup can forget its output source. A later process exit callback must not change a replacement server.

## UI rules

A task can have more than one action. The UI can choose one primary action and put the rest in a menu. Display order is a UI rule. The backend list remains the authority.

Non-closed Kanban cards show shortcuts for existing Spec, Planner, Builder, and QA sessions above the main action. The card omits a shortcut when the main control opens the same session. The menu contains the remaining valid actions.

Each session shortcut opens the preferred active session for its role or the latest historical session. The selected target keeps its external session ID, runtime, and working directory. Opening a shortcut does not create a session or change task status.

Current card and detail views use all action IDs except `view_details`, which the card click and details panel already provide.

When you add an action ID, update backend derivation, the transition matrix, the status and action docs, and UI mapping in one change.
