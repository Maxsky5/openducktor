import { realpath } from "node:fs/promises";
import {
  createDefaultGitRunner,
  type GitCommandRunner,
  referenceExists,
  resolveGitCommonDirectory,
  runGit,
  runGitAllowFailure,
} from "../../infrastructure/git/git-command-runner";
import { buildFileDiffs, loadDiffPayload } from "../../infrastructure/git/git-diff";
import {
  isAncestor,
  mergeBranch,
  suggestedSquashCommitMessage,
  switchBranch,
} from "../../infrastructure/git/git-merge";
import { resetWorktreeSelection } from "../../infrastructure/git/git-reset";
import {
  getCurrentBranchUnchecked,
  getStatusUnchecked,
  parseAheadBehind,
  parseBranchRows,
  parseRemoteNames,
} from "../../infrastructure/git/git-status";
import {
  abortConflict,
  commitAll,
  fetchRemote,
  pullBranch,
  pushBranch,
  rebaseAbort,
  rebaseBranch,
} from "../../infrastructure/git/git-sync";
import {
  configureBranchUpstream,
  createWorktree,
  deleteLocalBranch,
  deleteReference,
  removeWorktree,
} from "../../infrastructure/git/git-worktree";
import {
  buildWorktreeStatusData,
  buildWorktreeStatusSummaryData,
} from "../../infrastructure/git/git-worktree-status";
import type { GitPort, GitRemote } from "../../ports/git-port";

export type {
  GitCommandResult,
  GitCommandRunner,
} from "../../infrastructure/git/git-command-runner";

export type CreateGitCliAdapterInput = {
  processEnv?: NodeJS.ProcessEnv;
  runner?: GitCommandRunner;
};

export const createGitCliAdapter = ({
  processEnv = process.env,
  runner = createDefaultGitRunner(processEnv),
}: CreateGitCliAdapterInput = {}): GitPort => ({
  canonicalizePath(inputPath) {
    return realpath(inputPath);
  },
  async isGitRepository(workingDirectory) {
    const result = await runGitAllowFailure(runner, workingDirectory, [
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    return result.ok && result.stdout.trim() === "true";
  },
  async shareGitCommonDirectory(repoPath, workingDir) {
    const [repoCommonDir, workingCommonDir] = await Promise.all([
      resolveGitCommonDirectory(runner, repoPath),
      resolveGitCommonDirectory(runner, workingDir),
    ]);
    return repoCommonDir === workingCommonDir;
  },
  referenceExists(workingDir, reference) {
    return referenceExists(runner, workingDir, reference);
  },
  async listRemotes(workingDirectory) {
    const remoteNames = parseRemoteNames(await runGit(runner, workingDirectory, ["remote"]));
    const remotes: GitRemote[] = [];

    for (const name of remoteNames) {
      const result = await runGitAllowFailure(runner, workingDirectory, [
        "remote",
        "get-url",
        name,
      ]);
      const url = result.stdout.trim();
      if (result.ok && url) {
        remotes.push({ name, url });
      }
    }

    return remotes;
  },
  async listBranches(workingDirectory) {
    const output = await runGit(runner, workingDirectory, [
      "for-each-ref",
      "--format=%(if)%(HEAD)%(then)1%(else)0%(end)|%(refname:short)|%(refname)",
      "refs/heads",
      "refs/remotes",
    ]);
    return parseBranchRows(output);
  },
  getCurrentBranch(workingDirectory) {
    return getCurrentBranchUnchecked(runner, workingDirectory);
  },
  getStatus(workingDirectory) {
    return getStatusUnchecked(runner, workingDirectory);
  },
  async getDiff(workingDirectory, targetBranch) {
    const payload = await loadDiffPayload(runner, workingDirectory, targetBranch);
    const fileStatuses = await getStatusUnchecked(runner, workingDirectory);
    return buildFileDiffs(runner, workingDirectory, fileStatuses, payload.numstat, payload.diff);
  },
  getWorktreeStatusData(workingDirectory, targetBranch, diffScope) {
    return buildWorktreeStatusData(runner, workingDirectory, targetBranch, diffScope);
  },
  getWorktreeStatusSummaryData(workingDirectory, targetBranch, diffScope) {
    return buildWorktreeStatusSummaryData(runner, workingDirectory, targetBranch, diffScope);
  },
  createWorktree(repoPath, worktreePath, branch, createBranch, startPoint) {
    return createWorktree(runner, repoPath, worktreePath, branch, createBranch, startPoint);
  },
  configureBranchUpstream(repoPath, worktreePath, branch, upstreamRemote) {
    return configureBranchUpstream(runner, repoPath, worktreePath, branch, upstreamRemote);
  },
  deleteReference(repoPath, reference) {
    return deleteReference(runner, repoPath, reference);
  },
  removeWorktree(repoPath, worktreePath, force) {
    return removeWorktree(runner, repoPath, worktreePath, force);
  },
  deleteLocalBranch(repoPath, branch, force) {
    return deleteLocalBranch(runner, repoPath, branch, force);
  },
  isAncestor(workingDirectory, ancestor, descendant) {
    return isAncestor(runner, workingDirectory, ancestor, descendant);
  },
  suggestedSquashCommitMessage(workingDirectory, sourceBranch, targetBranch) {
    return suggestedSquashCommitMessage(runner, workingDirectory, sourceBranch, targetBranch);
  },
  mergeBranch(workingDirectory, request) {
    return mergeBranch(runner, workingDirectory, request);
  },
  switchBranch(workingDirectory, branch, create) {
    return switchBranch(runner, workingDirectory, branch, create);
  },
  resetWorktreeSelection(workingDirectory, fileDiffs, selection) {
    return resetWorktreeSelection(runner, workingDirectory, fileDiffs, selection);
  },
  async commitsAheadBehind(workingDirectory, targetBranch) {
    const target = targetBranch.trim();
    if (!target) {
      throw new Error("target branch is required");
    }

    const range = `${target}...HEAD`;
    const output = await runGit(runner, workingDirectory, [
      "rev-list",
      "--count",
      "--left-right",
      "--end-of-options",
      range,
    ]);
    return parseAheadBehind(output);
  },
  fetchRemote(workingDirectory, targetBranch) {
    return fetchRemote(runner, workingDirectory, targetBranch);
  },
  pullBranch(workingDirectory) {
    return pullBranch(runner, workingDirectory);
  },
  commitAll(workingDirectory, message) {
    return commitAll(runner, workingDirectory, message);
  },
  pushBranch(workingDirectory, branch, options) {
    return pushBranch(runner, workingDirectory, branch, options);
  },
  rebaseBranch(workingDirectory, targetBranch) {
    return rebaseBranch(runner, workingDirectory, targetBranch);
  },
  rebaseAbort(workingDirectory) {
    return rebaseAbort(runner, workingDirectory);
  },
  abortConflict(workingDirectory, operation) {
    return abortConflict(runner, workingDirectory, operation);
  },
});
