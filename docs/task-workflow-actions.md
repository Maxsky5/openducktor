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
- `remove_worktree`
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
| `human_approve` | Open the approval modal for an `ai_review` or `human_review` task. No direct transition. |

## Event actions

An event action sends one workflow event. When the event names a host effect, the client calls the command of that effect, such as `task_close` for `task.close`. When the event has no effect, the client calls `task_apply_event` with the event ID. The host rejects `task_apply_event` for an event that has an effect, that no event action sends, or whose action is not available for the task. All event actions of the built-in workflow have an effect.

`human_approve` is the exception. It opens the approval modal and does not send its event. The host uses the `review.approve` event only to admit the approval reads. The modal then runs a direct merge, a pull request action, or `task_close`.

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

The host waits for publication consent, then completes publication, cleanup, and closure in one operation. An unfinished merge requires manual Git review after a host restart because its original applied-commit evidence is no longer available.

Cleanup releases the live state of the task sessions before it removes the task worktree. A later runtime read then does not report the removed worktree as a session fault, so Delete can run on the closed task.

`task_direct_merge` and `task_direct_merge_complete` require the `removeWorktree` cleanup choice. The direct merge record does not store it. The Complete Direct Merge stage keeps the choice of the approval step while the modal stays open. After Finish Later, the stage starts from the default choice again. When the close fails after its cleanup, a retry follows its own choice: a retry that removes the worktree removes it, also when the failed attempt kept it.

## Approval modal

`human_approve` opens the approval modal. The modal offers Direct Merge, Pull Request, and Close Task. Pull Request shows only when the provider supports pull requests.

Close Task closes the task with `task_close`. It merges no code and creates, updates, or merges no pull request. Uncommitted changes block Direct Merge and Pull Request. They do not block Close Task.

The modal selects Close Task when the latest merge detection result says that the task branch is merged. Otherwise it selects Pull Request or Direct Merge from the provider state. Check again runs a merge detection pass for the whole workspace. It then reads the task branch tip again, and the status shows after both reads end. "Check merged tasks" in the command palette runs the same pass on request, as "Sync pull requests" does for pull requests. It asks you to choose the named workspace or all open workspaces. The named choice uses the palette workspace filter, then the active workspace, and the run does not switch the active workspace. All open workspaces run at most four at a time, as the scheduled passes do. A loading toast shows while the passes run, because each fetch can take seconds. The result then replaces it with one line for each workspace: the number of merged task branches and failed checks, or the reason of a failure. Cancel starts no check.

When the builder worktree is missing, the modal offers Close Task and Reset Implementation.

When the approval context read fails, for example on a detached task worktree or an invalid target, the modal stays open with Close Task selected. It shows the read error, and Direct Merge and Pull Request stay disabled.

Direct Merge and Complete Direct Merge show the same cleanup details as a close confirmation. Their text follows the cleanup checkbox.

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

`close_task` moves any non-closed task to `closed`. It is an administrative override.

The action keeps the task record, user fields, all artifacts, session history, pull request data, and direct merge data. It stops task terminals and running sessions. The `removeWorktree` input of `task_close` sets the worktree cleanup. If cleanup is unsafe or incomplete, the action fails with an error and the task keeps its status.

Reject it while a live role owns mutable task state.

The task detail sheet shows `close_task` for every non-closed task. A Kanban card and the session page header show it only for a task with a merged task branch. Do not show it in a bulk action or the command palette.

The detail sheet, the Kanban card, and the session page header open one shared close confirmation. It shows the task, its merge status, the cleanup choice, the terminals and sessions that stop, and the data that stays. When the task branch is not detected as merged, the confirmation warns that no code is merged.

## Worktree cleanup on close

The global setting `git.removeWorktreeOnClose` sets whether a close removes the task worktree and local task branch. It is on by default. It applies to all workspaces.

The task field `removeWorktreeOnClose` has the same meaning for one task. `true` removes, `false` keeps, and `null` follows the global setting. New and existing tasks start with `null`. The `tasks.remove_worktree_on_close` column stores it as 1, 0, or NULL. MCP tools do not set this field.

Each user close confirmation shows the switch "Remove worktree and branch", in the same card as the Archive chat dialog. It starts from the task value, else from the global setting. The choice applies to that close only.

| Close path | Cleanup value |
|---|---|
| `task_close` | `removeWorktree` input |
| `task_direct_merge` | `removeWorktree` input |
| `task_direct_merge_complete` | `removeWorktree` input |
| `task_pull_request_link_merged` | `removeWorktree` input |
| Pull request sync | Task value, else global setting |

When the value is `true`, a close that the user confirms removes the managed worktrees and related local branches. This covers Close Task, Direct Merge, Complete Direct Merge, and the merged pull request link, so each confirmation lists what its close removes. A manual close and a merged pull request link also remove a worktree with uncommitted files, because their confirmation shows the count. Direct Merge does not force the removal. Pull request sync has no confirmation, so it removes only the task worktree that has the source branch checked out, and that branch. It does not force the removal, so a worktree with uncommitted files fails that close. When the value is `false`, the worktree, its files, and the local task branch stay. The close still stops task terminals.

## Remove worktree

`remove_worktree` removes the worktree of a closed task. The backend adds it for every closed task. The detail sheet shows it while the task has a managed worktree or a related local branch. Only a successful read that finds neither hides it. When the sheet read fails, the action stays and the sheet shows the error with a Retry action.

`task_worktree_remove` stops task terminals, then removes the managed worktrees and related local branches. It force-deletes the branches, so the confirmation warns that commits that exist only on this branch may be lost, as the Archive chat dialog does. It does not change the status, artifacts, session history, or pull request data. If cleanup fails, it returns the error with the cleanup progress.

`task_worktree_cleanup_impact_get` returns the existing worktrees that the cleanup removes, the branches that it deletes, the uncommitted file count of those worktrees, the current task branch tip, and whether merge detection checks the task. The worktrees are the task worktree and the saved session worktrees, as in `task_close` and `task_worktree_remove`. Confirmations read it only while they are open. A failed read shows its error and a Retry action, and Confirm stays disabled until a read succeeds.

## Merge detection

The host checks whether task branches are merged into their targets. It never closes a task by itself. It only proposes the close.

A task is a candidate when all of these conditions are true:

- Its status is `in_progress`, `blocked`, `ai_review`, or `human_review`.
- Its local task branch exists.
- It has no pending direct merge.

The target is the saved task target, else the repository default target.

The task sync loop syncs up to four open workspaces at a time. For each workspace, it checks one time that the workspace is still open and has no incomplete removal. It then runs the pull request sync and then the detection pass. A workspace that closed after the loop listed it runs nothing. The first iteration runs at host start. `task_merge_status_check` runs a pass on request, and it fails for a workspace that is not open. One pass runs at a time for each workspace, and a request during a pass gets the result of that pass.

A pass reads the task list first. Without candidates, it makes no Git call. Otherwise it fetches each target remote once through the [shared remote fetch](git-comparison.md#remote-fetch). A scheduled pass skips a remote that a fetch of the last five minutes updated. `task_merge_status_check` always fetches.

A pass checks again only the candidates whose branch tip or target tip changed. The number of Git calls does not grow with the number of tasks. One `git log -g --stdin` call reads the reflogs of all new branch tips, and each result stays until its tip moves. Only a reflog with a reset entry adds `git merge-base --is-ancestor` calls. Then one `git for-each-ref --format=%(ahead-behind:<target>)` call for each target tip counts the commits of the task branches that the target does not have. One `git merge-tree --write-tree --stdin` call writes the merge trees of all branches that need the tree check. The references and the merge pairs go on stdin or as one branch prefix pattern, so many tasks do not make a command line that is too long. At most four Git commands of merge detection run at a time, for all workspaces together.

The check uses Git facts only. First it reads the branch reflog, newest entry first, to find a commit that the branch got after its creation:

- A `commit`, `cherry-pick:`, `revert:`, or `am:` entry is such an own commit.
- A `branch: Created` entry ends the scan with no own commit.
- A `reset:` or `branch: Reset` entry sets the branch to its new tip. After the newest reset, an older `commit` entry counts only when the tip of that reset holds the commit. So a reset that keeps some or all task commits, or a reset back to a dropped commit, does not hide them.
- A rebase replaces the earlier commits with new commits on its base. A `rebase (finish): <ref> onto <base>` entry before the newest reset counts when the reset tip is in the rebased history and is not in the base.
- Pull entries and other rebase entries do not count.

Git maintenance expires old reflog entries, so an empty reflog is a normal case. Commits that the target does not have are then the work of the branch. A tip that the target has can be a branch that never got a commit, so it has nothing to merge.

| Branch | Condition | Result |
|---|---|---|
| No own commit | Any | Not merged, with count 0 |
| Own commit, tip is an ancestor of the target | Any | Merged |
| Empty reflog, tip is an ancestor of the target | Any | Not merged, with count 0 |
| Own commit or empty reflog, tip is not an ancestor of the target | `git merge-tree --write-tree` gives the target tree | Merged |
| Own commit or empty reflog, tip is not an ancestor of the target | Other cases | Not merged, with the unmerged commit count |

The tree check finds rebase and squash merges. A squash merge that later target commits hide shows as not merged. Merge detection needs Git 2.41 or later, and the Git row of the diagnostics shows an issue for an older Git.

A failed fetch or check keeps the last result and adds the failure. A failed reflog, count, or merge tree call fails only the checks that need it. The host logs the repository path, remote, and error. It tries again on the next pass.

Each result names the branch tip that it checked. A close confirmation reads the current tip. When the branch moved after the check, the confirmation shows the merge status as not checked and keeps the warning about unmerged commits. A failed later check still shows its reason and the time of the last successful check.

The host keeps the results in memory only. It publishes the full workspace snapshot on `openducktor://task-merge-status-updated` after each pass. `task_merge_status_get` returns the current snapshot.

A task shows a merged proposal when its result is merged, its status is a candidate status, and `close_task` is available. The Kanban card then shows a "Merged" marker and Close Task as its main action. The session page header shows Close Task as its primary action, with a marker that names the target.

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

Pull request sync records the merged pull request. Before it closes the task, it stops task terminals and live task sessions and releases the task sessions. It removes the task worktree and local source branch when the task value or the global setting asks for it. If cleanup fails, the task keeps its current status and the host reports the error.

The merged pull request confirmation shows the cleanup choice. `task_pull_request_link_merged` sends it as `removeWorktree`. The link stops task terminals and live task sessions, so the confirmation reads the worktree, terminal, and session impact.

## UI rules

A task can have more than one action. The UI can choose one primary action and put the rest in a menu. Display order is a UI rule. The backend list remains the authority.

The Close, Delete, and Reset Task confirmations count the task worktrees that the host still finds and the action removes. A worktree that Approve already removed does not count.

Non-closed Kanban cards show shortcuts for existing Spec, Planner, Builder, and QA sessions above the main action. The card omits a shortcut when the main control opens the same session. The menu contains the remaining valid actions.

Each session shortcut opens the preferred active session for its role or the latest historical session. The selected target keeps its external session ID, runtime, and working directory. Opening a shortcut does not create a session or change task status.

Current card and detail views use all action IDs except `view_details`, which the card click and details panel already provide.

The session page header shows Approve Task for an `ai_review` or `human_review` task that allows `human_approve`. It opens the approval modal. For a `human_review` task, Approve Task is the primary action when the repository has no enabled Git provider. Otherwise it follows the session actions. Close Task leads for a merged task branch. An enabled Git conflict action stays first. A task action starts no session, so a working session does not disable it. The quick-actions menu then stays available for it while the session actions are disabled.

When you add an action ID, update backend derivation, the transition matrix, the status and action docs, and UI mapping in one change.
