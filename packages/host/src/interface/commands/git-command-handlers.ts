import type { GitService } from "../../application/git/git-service";
import type { HostCommandHandlers } from "../router/host-command-router";
import {
  parseGitAbortConflictInput,
  parseGitAheadBehindInput,
  parseGitCommitAllInput,
  parseGitCreateWorktreeInput,
  parseGitDiffInput,
  parseGitPushBranchInput,
  parseGitRebaseBranchInput,
  parseGitRemoveWorktreeInput,
  parseGitResetWorktreeSelectionInput,
  parseGitScopeInput,
  parseGitSwitchBranchInput,
  parseGitWorktreeStatusInput,
} from "./git-command-inputs";

export const createGitCommandHandlers = (gitService: GitService): HostCommandHandlers => ({
  git_canonicalize_path: (args) => gitService.canonicalizePath(parseGitScopeInput(args)),
  git_abort_conflict: (args) => gitService.abortConflict(parseGitAbortConflictInput(args)),
  git_commit_all: (args) => gitService.commitAll(parseGitCommitAllInput(args)),
  git_commits_ahead_behind: (args) => gitService.commitsAheadBehind(parseGitAheadBehindInput(args)),
  git_create_worktree: (args) => gitService.createWorktree(parseGitCreateWorktreeInput(args)),
  git_fetch_remote: (args) => gitService.fetchRemote(parseGitAheadBehindInput(args)),
  git_get_branches: (args) => gitService.getBranches(parseGitScopeInput(args)),
  git_get_current_branch: (args) => gitService.getCurrentBranch(parseGitScopeInput(args)),
  git_get_diff: (args) => gitService.getDiff(parseGitDiffInput(args)),
  git_get_status: (args) => gitService.getStatus(parseGitScopeInput(args)),
  git_get_worktree_status: (args) =>
    gitService.getWorktreeStatus(parseGitWorktreeStatusInput(args)),
  git_get_worktree_status_summary: (args) =>
    gitService.getWorktreeStatusSummary(parseGitWorktreeStatusInput(args)),
  git_pull_branch: (args) => gitService.pullBranch(parseGitScopeInput(args)),
  git_push_branch: (args) => gitService.pushBranch(parseGitPushBranchInput(args)),
  git_rebase_abort: (args) => gitService.rebaseAbort(parseGitScopeInput(args)),
  git_rebase_branch: (args) => gitService.rebaseBranch(parseGitRebaseBranchInput(args)),
  git_remove_worktree: (args) => gitService.removeWorktree(parseGitRemoveWorktreeInput(args)),
  git_reset_worktree_selection: (args) =>
    gitService.resetWorktreeSelection(parseGitResetWorktreeSelectionInput(args)),
  git_switch_branch: (args) => gitService.switchBranch(parseGitSwitchBranchInput(args)),
});
