import type { GitService } from "./git-service";
import type { HostCommandHandlers } from "./host-command-router";

export const createGitCommandHandlers = (gitService: GitService): HostCommandHandlers => ({
  git_abort_conflict: (args) => gitService.abortConflict(args),
  git_commit_all: (args) => gitService.commitAll(args),
  git_commits_ahead_behind: (args) => gitService.commitsAheadBehind(args),
  git_create_worktree: (args) => gitService.createWorktree(args),
  git_fetch_remote: (args) => gitService.fetchRemote(args),
  git_get_branches: (args) => gitService.getBranches(args),
  git_get_current_branch: (args) => gitService.getCurrentBranch(args),
  git_get_diff: (args) => gitService.getDiff(args),
  git_get_status: (args) => gitService.getStatus(args),
  git_get_worktree_status: (args) => gitService.getWorktreeStatus(args),
  git_get_worktree_status_summary: (args) => gitService.getWorktreeStatusSummary(args),
  git_pull_branch: (args) => gitService.pullBranch(args),
  git_push_branch: (args) => gitService.pushBranch(args),
  git_rebase_abort: (args) => gitService.rebaseAbort(args),
  git_rebase_branch: (args) => gitService.rebaseBranch(args),
  git_remove_worktree: (args) => gitService.removeWorktree(args),
  git_reset_worktree_selection: (args) => gitService.resetWorktreeSelection(args),
  git_switch_branch: (args) => gitService.switchBranch(args),
});
