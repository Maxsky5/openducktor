# Task workflow actions

The backend returns allowed workflow actions in `TaskCard.availableActions`. The frontend renders that list. It does not infer workflow actions from status.

OpenDucktor also gives every task the core task actions Close Task, Reset Task, and Remove Worktree. No workflow declares them, so they are not in `availableActions`. Each client shows Close Task and Reset Task for every task that is not `closed`, from `coreTaskActions(task)` in `packages/frontend-core`. Remove Worktree applies to a `closed` task, from `canRemoveTaskWorktree(task)` in the same module.

Approve is also an OpenDucktor feature. A workflow only declares when it is available, with one action of kind `approval`. Read [the architecture overview](architecture-overview.md#change-task-workflow-state) for the approval and pull request rules.

Read [the status model](task-workflow-status-model.md) for status and issue type rules. Read [the transition matrix](task-workflow-transition-matrix.md) for all transition guards.

## Action IDs

The built-in workflow declares these workflow actions:

- `view_details`
- `set_spec`
- `set_plan`
- `build_start`
- `open_builder`
- `reset_implementation`
- `qa_start`
- `open_qa`
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
| `human_request_changes` | Collect feedback, then move `ai_review` or `human_review` to `in_progress` and start the Builder with the feedback. |
| `human_approve` | The `approval` action. Open the approval modal for an `ai_review` or `human_review` task. No direct transition. |

## Event actions

An event action sends one workflow event. The client calls `task_apply_event` with the event ID. The host rejects an event that no event action sends, or whose action is not available for the task. The host runs the host effects of the event in order, then commits the event. When an effect fails, the host commits nothing.

The client operation follows the event:

- An event with the `worktree.reset` effect opens the Reset Implementation confirmation first. `reset_implementation` uses it.
- An event action whose following launch has `context: "human_feedback"` opens the feedback form first. `human_request_changes` uses it. The session start sends `beforeStartAction: { eventId, note }`, and the host commits the event before the session starts. Without a launch to start, the form sends `task_apply_event`.
- Another event action sends `task_apply_event` directly, then starts its following launch when it has one.

`human_approve` is an `approval` action, not an event action. It opens the approval modal and sends no event. The host allows the approval reads and writes while the `availableWhen` condition of this action matches the task.

## Session startup

Spec, Planner, Builder, and QA sessions use the canonical task worktree directory. An existing directory must be a registered worktree of the workspace repository. It must not resolve to the repository root.

Session startup accepts any branch or detached HEAD in that worktree. It keeps the current branch and files. If the worktree does not exist, startup creates it with the configured task branch name and runs the configured copy paths and hooks.

Autopilot submits its first instruction through the host message queue. If the selected session is working, the instruction waits for the current turn to complete. It keeps its place behind earlier queued messages. Stop, failed turns, and interrupted turns pause the queue under the normal message delivery rules.

Stop also cancels Autopilot submissions that are still being prepared. A canceled submission cannot send its instruction or add it to the queue.

## Artifact actions

`set_spec` writes or revises the specification. From `open`, it moves the task to `spec_ready`. In any other allowed status, it changes only the artifact.

`set_plan` writes or revises the implementation plan. A `feature` can use it from `spec_ready` or any later active status. A `task` or `bug` can also use it from `open`. Valid planning before a build moves the task to `ready_for_dev`. A later edit changes only the artifact.

Builder can revise the spec with `odt_set_task_artifact` and code `spec`, and the plan with code `plan` when implementation findings require artifact changes. Builder must get user approval before changing required scope, design contracts, or security posture. Each call saves the complete Markdown artifact for the session task. Revisions from `in_progress`, `blocked`, `ai_review`, or `human_review` keep the task status unchanged.

Manual document saves use `workflow_artifact_save` with `submit: false`. They keep task status unchanged, including on closed tasks. They send no workflow event.

`odt_set_task_artifact` submits workflow artifacts. A document save sends the save event of its artifact. A review save requires a declared verdict, sends the event of that verdict, and commits the report with its status change. Code `qaReport` completes one QA review pass. Build completion remains separate. Managed workflow writes follow the role policy described in [external MCP](external-mcp.md#tool-access).

Users and workflow agents can create, rename, replace, and delete free artifacts on non-closed tasks. These operations cannot change workflow artifacts, task status, QA verdict, or workflow readiness. Closed tasks keep read, preview, and download access. See [task artifacts](task-artifacts.md) for collection behavior and [artifact tools](external-mcp.md) for inputs and transfer limits.

## Direct merge

Stop all running sessions for the task before direct merge or its completion. The host checks linked roots and verified descendants before it changes Git. While either operation runs, the host rejects conflicting starts, resumes, forks, continuation, model actions, and message delivery.

A direct merge without a publish target closes the task. A direct merge with a publish target keeps the task state. The host waits for publication consent, then completes publication, cleanup, and closure in one operation. An unfinished merge requires manual Git review after a host restart because its original applied-commit evidence is no longer available.

While a recorded local merge waits for its publication, the host rejects every workflow event, artifact submit event, session start event, Request Changes, and Reset Task. Publish the merge, close the task, or reset the implementation.

Cleanup releases the live state of the task sessions before it removes the task worktree. A later runtime read then does not report the removed worktree as a session fault, so Delete can run on the closed task.

## Approval modal

The approval modal offers Direct Merge, Pull Request, and Close Task. Pull Request needs a provider that supports pull requests. A pull request keeps the task state. Close Task runs `task_close`, so it merges no code and changes no pull request.

Uncommitted changes block Direct Merge and Pull Request. When merge detection reports the task branch as merged, the modal selects Close Task. When the builder worktree is missing, the modal offers Close Task and Reset Implementation. When the approval context read fails, it offers only Close Task.

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

Reset Task is a core task action. It moves any task that is not `closed` to `open`, with no workflow event. A reset of an `open` task keeps the status and still clears the task. The host rejects a reset of a `closed` task. It keeps the task ID and user fields.

It clears all workflow and free artifacts, linked role sessions, pull request data, direct merge data, and in-memory runs. It stops task terminals, then removes task worktrees and related local branches.

Reject the action while a live role still owns task state. Reject it when branch cleanup is unsafe, such as when another worktree has the branch checked out.

## Close task

Close Task is a core task action. It moves any task that is not `closed` to `closed`, with no workflow event. A close of a `closed` task changes nothing. It is an administrative override.

The action keeps the task record, user fields, all artifacts, session history, pull request data, and direct merge data. It stops task terminals and running sessions. It removes the task worktrees only when `removeWorktree` is `true`. If cleanup is unsafe or incomplete, the action fails and the task keeps its status.

Reject it while a live role owns mutable task state.

The task detail sheet, the command palette, and the mobile task details show Close Task and Reset Task for every task that is not `closed`. A Kanban card does not show them. A Kanban card and the session page header show Close Task as their main action, with a "Merged" marker, only for a merged task branch. Do not show them in a bulk action.

## Worktree cleanup on close

The global setting `git.removeWorktreeOnClose` sets whether a close removes the task worktrees and related local branches. It is on by default. The task field `removeWorktreeOnClose` overrides it for one task: `true` removes, `false` keeps, and `null` follows the setting.

Each user close command takes a required `removeWorktree` value: `task_close`, `task_direct_merge`, `task_direct_merge_complete`, and `task_pull_request_link_merged`. Its confirmation starts from the task value, else the setting. The choice applies to that close only. Pull request sync has no confirmation, so it uses the task value, else the setting.

A confirmed close removes the task worktree, the session worktrees, and the related local branches. Pull request sync removes only the worktree of the source branch and that branch, and uncommitted files make that close fail. A close that keeps the worktree still stops task terminals.

## Remove worktree

Remove Worktree is a core task action of a closed task. The host rejects `task_worktree_remove` for a task that is not `closed`. The detail sheet reads the worktree of a closed task and shows the action while the task has a managed worktree or a related local branch. The desktop detail sheet and the mobile task details show it in the actions menu, after Reset Task and Close Task and before Delete Task. The command palette and the Kanban card do not show it, because they do not read the worktree.

`task_worktree_remove` stops task terminals, removes the managed worktrees, and force-deletes the related local branches. Commits that exist only on these branches are lost. It changes no other task data.

## Other owners of a task worktree

The host checks the others that need a task worktree before Close, Delete, Reset Task, Reset Implementation, Remove worktree, and merged task cleanup remove it. It uses the owner rules of chat archive with worktree removal. It checks every configured workspace, also closed workspaces. It compares paths after alias resolution, so a symlink path and its real path are the same worktree.

| Owner | Effect |
|---|---|
| Another workspace that uses the worktree as its repository checkout | Blocks. Remove that workspace. |
| An open task, other than the task itself, whose worktree or session uses the directory | Blocks. Close that task. |
| A saved chat that works in the worktree and is not archived | Blocks. Archive that chat. |
| A saved Claude chat whose native history uses the worktree, also when archived | Warns. The chat cannot resume after the removal. |

Each confirmation reads these owners with `task_worktree_owners_get` when it opens, and shows its content when this read also has its first result. A close, approval, or merged pull request confirmation uses the owners only while its choice removes the worktree, so a change of that choice only changes their color. A blocking owner disables Confirm, and the host also refuses the cleanup before it stops task sessions or removes a worktree. A confirmed cleanup removes a worktree that only Claude history needs, because its confirmation showed the warning.

A saved Claude chat whose native history the host cannot read only warns in a confirmation, and the warning names the chat and its workspace. A failed owner read blocks only the removal, and its error row has a retry.

Pull request sync closes a merged task without a confirmation. It also blocks on a Claude history owner, so the user must close that task. A task that cannot close does not stop the sync of the other tasks. The sync then fails with the reason for each task.

The host keeps each task that the last pull request sync could not close in memory, and does not save it. The merge status snapshot lists these tasks in `autoCloseFailures`. The task card shows the reason and proposes Close Task. The first failure of a task since the host started sends one `task.auto_close_blocked` notification, which opens the task on the board. A later sync that fails again sends no notification. A sync that closes the task, or no longer fails, removes the failure.

A worktree that no longer exists has nothing to remove, so its owners do not count.

## Before worktree removal script

The repository setting `hooks.beforeWorktreeRemoval` holds one command per line. The host runs these commands in a task worktree right before it removes that worktree. Close, Delete, Reset Task, Reset Implementation, Remove worktree, and merged task cleanup run them. A worktree that no longer exists has no script run.

The host runs the commands in order. The first failed command stops the cleanup: the host keeps that worktree, deletes no branch, and does not change the task status. The error names the command and shows its output. Fix the cause, then run the action again.

## Merge detection

The host checks whether task branches are merged into their targets. It never closes a task. It only proposes Close Task.

A task is a candidate when its workflow sets `mergeDetection` on its current state, its local task branch exists, and it has no pending direct merge. The built-in workflow sets it on `in_progress`, `blocked`, `ai_review`, and `human_review`. The target is the saved task target, else the repository default target.

The task sync loop runs a pass for each open workspace every five minutes, after its pull request sync. `task_merge_status_check` runs a pass on request: Check again in the approval modal, and Check merged tasks in the command palette for one or all open workspaces. A pass fetches each target remote through the [shared remote fetch](git-comparison.md#remote-fetch).

A branch is merged when it has a commit of its own and the target holds its work. The target holds the work when it contains the branch tip, or when a merge of the branch into the target gives the target tree, as after a rebase or squash merge. The branch reflog gives the own commits: the `commit`, `cherry-pick`, `revert`, and `am` entries that the branch still holds after its resets and rebases. When Git maintenance has expired the older reflog entries, so that the creation entry is missing, commits that the target lacks count as own work, and a tip that the target holds is not merged.

Merge detection needs Git 2.41 or later. A failed check keeps the last result with the failure, and the next pass tries again.

The host keeps the results in memory and publishes each workspace snapshot on `openducktor://task-merge-status-updated`. Each result names the branch tip that it checked. A close confirmation shows a branch that moved after the check as not checked.

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

Pull request sync records the merged pull request. A merged pull request closes the task in any state that is not `closed`, with no workflow event. Before it closes the task, it stops task terminals and live task sessions and releases the task sessions. It removes the task worktree and local source branch when the task value or the global setting asks for it. If cleanup fails, the task keeps its current status and the host reports the error.

## UI rules

A task can have more than one action. The UI can choose one primary action and put the rest in a menu. Display order is a UI rule. The backend list remains the authority.

The Close, Delete, and Reset Task confirmations count the task worktrees that the host still finds and the action removes. A worktree that Approve already removed does not count.

Non-closed Kanban cards show shortcuts for existing Spec, Planner, Builder, and QA sessions above the main action. The card omits a shortcut when the main control opens the same session. The menu contains the remaining valid actions.

Each session shortcut opens the preferred active session for its role or the latest historical session. The selected target keeps its external session ID, runtime, and working directory. Opening a shortcut does not create a session or change task status.

Current card and detail views use all action IDs except `view_details`, which the card click and details panel already provide.

The session page header shows Approve Task for a task whose `approval` action is available. It leads for a `human_review` task when the repository has no enabled Git provider.

When you add an action ID, update backend derivation, the transition matrix, the status and action docs, and UI mapping in one change.
