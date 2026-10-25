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
| `human_approve` | Move `ai_review` or `human_review` to `closed`. |

## Event actions

An event action sends one workflow event. When the event names a host effect, the client calls the command of that effect, such as `task_close` for `task.close`. When the event has no effect, the client calls `task_apply_event` with the event ID. The host rejects `task_apply_event` for an event that has an effect, that no event action sends, or whose action is not available for the task. All event actions of the built-in workflow have an effect.

## Session startup

Spec, Planner, Builder, and QA sessions use the canonical task worktree directory. An existing directory must be a registered worktree of the workspace repository. It must not resolve to the repository root.

Session startup accepts any branch or detached HEAD in that worktree. It keeps the current branch and files. If the worktree does not exist, startup creates it with the configured task branch name and runs the configured copy paths and hooks.

Autopilot submits its first instruction through the host message queue. If the selected session is working, the instruction waits for the current turn to complete. It keeps its place behind earlier queued messages. Stop, failed turns, and interrupted turns pause the queue under the normal message delivery rules.

Stop also cancels Autopilot submissions that are still being prepared. A canceled submission cannot send its instruction or add it to the queue.

## Artifact actions

`set_spec` writes or revises the specification. From `open`, it moves the task to `spec_ready`. In any other allowed status, it changes only the artifact.

`set_plan` writes or revises the implementation plan. A `feature` can use it from `spec_ready` or any later active status. A `task` or `bug` can also use it from `open`. Valid planning before a build moves the task to `ready_for_dev`. A later edit changes only the artifact.

Builder can revise the spec with `odt_set_task_artifact` and code `spec`, and the plan with code `plan` when implementation findings require artifact changes. Builder must get user approval before changing required scope, design contracts, or security posture. Each call saves the complete Markdown artifact for the session task. Revisions from `in_progress`, `blocked`, `ai_review`, or `human_review` keep the task status unchanged.

Manual document saves use `workflowArtifactSave` with `submit: false`. They keep task status unchanged, including on closed tasks. They send no workflow event.

`odt_set_task_artifact` submits workflow artifacts. A document save sends the save event of its artifact. A review save requires a declared verdict, sends the event of that verdict, and commits the report with its status change. Code `qaReport` completes one QA review pass. Build completion remains separate. Managed workflow writes follow the role policy described in [external MCP](external-mcp.md#tool-access).

Users and workflow agents can create, rename, replace, and delete free artifacts on non-closed tasks. These operations cannot change workflow artifacts, task status, QA verdict, or workflow readiness. Closed tasks keep read, preview, and download access. See [task artifacts](task-artifacts.md) for collection behavior and [artifact tools](external-mcp.md) for inputs and transfer limits.

## Direct merge

Stop all running sessions for the task before direct merge or its completion. The host checks linked roots and verified descendants before it changes Git. While either operation runs, the host rejects conflicting starts, resumes, forks, continuation, model actions, and message delivery.

The host waits for publication consent, then completes publication, cleanup, and closure in one operation. An unfinished merge requires manual Git review after a host restart because its original applied-commit evidence is no longer available.

Cleanup releases the live state of the task sessions before it removes the task worktree. A later runtime read then does not report the removed worktree as a session fault, so Delete can run on the closed task.

## Reset implementation

`reset_implementation` discards the current build and QA attempt. It can run from `in_progress`, `blocked`, `ai_review`, or `human_review`.

Choose the target from the artifacts that remain:

- Use `ready_for_dev` when the plan remains.
- Use `spec_ready` when only the specification remains.
- Use `open` when neither remains.

The reset removes QA Report history and keeps all free artifacts.

Before the reset:

- Reject the action while a live task role uses the canonical worktree.
- Check the canonical worktree and task branch.
- Restore tracked files to the local base. Remove ordinary untracked files and keep ignored files.
- Keep the canonical worktree, task branch, specification, plan, and free artifacts. Do not rerun copy paths or hooks.

## Reset task

`reset_task` moves any non-closed task to `open`. It keeps the task ID and user fields.

It clears all workflow and free artifacts, linked role sessions, pull request data, direct merge data, and in-memory runs. It stops task terminals, then removes task worktrees and related local branches.

Reject the action while a live role still owns task state. Reject it when branch cleanup is unsafe, such as when another worktree has the branch checked out.

## Close task

`close_task` moves any non-closed task to `closed` from the task detail sheet. It is an administrative override.

The action keeps the task record, user fields, all artifacts, session history, pull request data, and direct merge data. It stops task terminals and removes managed worktrees and local branches. If cleanup is unsafe or incomplete, it fails with an error.

Reject it while a live role owns mutable task state.

Only the task detail sheet can show `close_task`. Do not show it on a Kanban card, Task Workflows quick action, bulk action, header, or command palette.

## Merged pull requests

Detect PR keeps its progress and results for the repository and task that started it when the user switches workspace. Linked results refresh that task and show a toast with its task ID and repository path. No-result warnings also show after a workspace switch.

Each task shows its own Detect PR or Unlink PR progress when several operations run in one workspace. Finishing one operation does not clear progress from another task.

A detected merged pull request waits for confirmation in its own workspace. If that workspace is inactive when detection finishes, a toast identifies the task and repository and tells the user to return. The confirmation shows when the user returns. Each task keeps its own confirmation. Cancel stays disabled while the merged link runs, including after the user switches away and back.

The confirmation names the task it will close. It always shows the task ID and shows the title captured from the initiating workspace when available. A workspace switch or another selected task does not change that identity.

Closing or removing a workspace clears its pending Detect PR requests and confirmations. Late detection results and errors do not restore them. Reopening requires a fresh Detect PR. A link or unlink already in progress keeps its busy guards and finishes in its original repository. A failed link does not restore a confirmation cleared by closure.

The host syncs pull requests for all open workspaces when it starts. It waits five minutes after each iteration before it syncs again. Closed workspaces and incomplete removals do not sync.

If one workspace sync fails, the host logs its repo path and the error, then continues with the other open workspaces. It tries the failed workspace again on the next interval.

Use "Sync pull requests" in the command palette to start a manual sync. Each run asks you to choose the named workspace or all open workspaces. The named choice uses the palette workspace filter, then the active workspace. It stays disabled while provider details load or the provider cannot sync. A note beside the choice gives the reason. The batch choice counts and targets only open workspaces whose provider is configured, enabled, supports pull requests, and is available. It stays disabled while eligibility reads are pending or failed. The dialog names each failed read with its error. Cancel starts no sync.

Manual sync keeps its chosen targets when you change pages or workspaces. The progress toast names the scope, and this client cannot start another manual run until it finishes. A batch run ignores workspaces without a configured, enabled Git provider. These workspaces do not cause a warning or appear in the result. If none can sync, the result explains that no open workspace has an enabled provider. Other skipped or failed workspaces remain in the result, with recovery instructions. A workspace that closes before its turn is skipped. Manual sync does not change the automatic schedule.

Pull request sync records the merged pull request. Before it closes the task, it stops task terminals and live task sessions, releases the task sessions, and removes the task worktree and local source branch. If cleanup fails, the task keeps its current status and the host reports the error.

## UI rules

A task can have more than one action. The UI can choose one primary action and put the rest in a menu. Display order is a UI rule. The backend list remains the authority.

The Close, Delete, and Reset Task confirmations count the task worktrees that the host still finds and the action removes. A worktree that Approve already removed does not count.

Non-closed Kanban cards show shortcuts for existing Spec, Planner, Builder, and QA sessions above the main action. The card omits a shortcut when the main control opens the same session. The menu contains the remaining valid actions.

Each session shortcut opens the preferred active session for its role or the latest historical session. The selected target keeps its external session ID, runtime, and working directory. Opening a shortcut does not create a session or change task status.

Current card and detail views use all action IDs except `view_details`, which the card click and details panel already provide.

When you add an action ID, update backend derivation, the transition matrix, the status and action docs, and UI mapping in one change.
