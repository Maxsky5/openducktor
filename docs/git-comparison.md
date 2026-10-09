# Session Git comparison

## Choose a comparison branch

Use the Target branch editor in the Git panel to choose a local or remote-tracking branch. This changes comparison diffs, comparison counts, file-tree markers, and the Rebase destination. It does not change checkout, branch tracking, the repository default, or the upstream used by Pull and Push.

Task and workspace sessions use the original task Git panel layout. Current branch and Target branch appear in cards with the comparison count above the arrow. The action lane keeps the original icons, order, badges, spacing, and tooltips. The diff tabs, empty states, and commit form keep their original layout. The target pencil opens the inline editor; its branch selector opens the searchable choices. In repository-root sessions, the current-branch pencil opens checkout choices. Worktree checkout rules stay the same. Help, loading, errors, and retry actions appear only while the target editor is open.

| Session context | Initial comparison | Choice owner |
| --- | --- | --- |
| Workspace repository root | Current branch upstream | This workspace session |
| Workspace worktree | Repository default | This workspace session |
| Task worktree | Saved task target or repository default | The task |
| Task repository root | Current branch upstream | No comparison editor |

## Workspace choice lifetime

A workspace comparison choice stays in app memory across session changes, workspace changes, page exits, branch changes, and tools-panel closure. It resets on app reload or a confirmed successful archive of that session. A failed archive retains the choice. Selecting Tracked upstream in a repository-root session removes its branch override.

Task target choices continue to use the saved task record. Sessions for the same task share its saved target.

## Comparison failures

The panel keeps the selected target visible when its comparison fails. Target diffs, counts, markers, and Rebase stay unavailable until the selected comparison succeeds. Use Refresh to fetch the selected remote and retry, or choose an available branch. A branch-list error has a separate Retry branches control.

Uncommitted reads and reset snapshots use `HEAD`. File browsing, Commit, and conflict recovery remain available when their own prerequisites hold. Pull and Push use actual branch tracking, even when the comparison branch differs.

A new task worktree can have upstream settings before its remote branch exists. A missing remote-tracking ref produces the untracked status, which permits the existing Push action to publish the branch. Comparison with another available branch remains usable. Other Git read errors remain visible.

If a task has no saved target and repository settings fail to load, the panel shows the settings error. Refresh retries that read. A saved task target remains usable when settings cannot load.

## Refresh

Focus and visibility refreshes fetch the selected target's remote when its five-minute fetch limit permits. Manual Refresh always attempts the fetch. Soft refresh reads local Git data without fetching. Concurrent refreshes for the same repository, directory, and target share a pending fetch.

Scheduled reads check summaries for both diff scopes. Unchanged diffs stay cached; changed snapshots trigger full reads. A completed reset keeps its original directory, and a late refresh error cannot appear in another session.

## Panel integration

The shared comparison control, check, refresh path, and read projection live in `packages/frontend/src/features/agent-studio-git`. Scope adapters own task persistence and workspace app memory. Keep Git action ownership mounted across tab and panel closure so a pending command retains its original directory, target, and operation lock. The dynamic-tabs task `openduckto-k0u1t` owns tab names and layout changes.

Every full read, summary read, and queued reload keeps its comparison context key. Query identity and result checks use that key so a branch or session change cannot accept an earlier pending response.
