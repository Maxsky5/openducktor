import {
  type GitResetWorktreeSelectionRequest,
  gitConflictOperationSchema,
  gitDiffScopeSchema,
  gitResetWorktreeSelectionRequestSchema,
} from "@openducktor/contracts";
import type {
  GitAbortConflictInput,
  GitAheadBehindInput,
  GitCommitAllInput,
  GitCreateWorktreeInput,
  GitDiffInput,
  GitPushBranchInput,
  GitRebaseBranchInput,
  GitRemoveWorktreeInput,
  GitScopeInput,
  GitSwitchBranchInput,
  GitWorktreeStatusInput,
} from "../../application/git/git-service-inputs";
import { HostValidationError } from "../../effect/host-errors";
import type { JsonValue } from "@openducktor/contracts";
import { optionalBoolean, optionalString, requireRecord, requireString } from "./command-inputs";

export const parseGitScopeInput = (input: JsonValue | undefined): GitScopeInput => {
  const record = requireRecord(input, "Git command input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const workingDir = optionalString(record.workingDir, "workingDir");

  return workingDir ? { repoPath, workingDir } : { repoPath };
};

export const parseGitAheadBehindInput = (input: JsonValue | undefined): GitAheadBehindInput => {
  const record = requireRecord(input, "Git ahead/behind input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const targetBranch = requireString(record.targetBranch, "targetBranch");
  const workingDir = optionalString(record.workingDir, "workingDir");

  return workingDir ? { repoPath, targetBranch, workingDir } : { repoPath, targetBranch };
};

export const parseGitSwitchBranchInput = (input: JsonValue | undefined): GitSwitchBranchInput => {
  const record = requireRecord(input, "Git switch branch input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    branch: requireString(record.branch, "branch"),
    create: optionalBoolean(record.create, "create") ?? false,
  };
};

export const parseGitCreateWorktreeInput = (
  input: JsonValue | undefined,
): GitCreateWorktreeInput => {
  const record = requireRecord(input, "Git create worktree input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    worktreePath: requireString(record.worktreePath, "worktreePath"),
    branch: requireString(record.branch, "branch"),
    createBranch: optionalBoolean(record.createBranch, "createBranch") ?? false,
  };
};

export const parseGitRemoveWorktreeInput = (
  input: JsonValue | undefined,
): GitRemoveWorktreeInput => {
  const record = requireRecord(input, "Git remove worktree input");
  return {
    repoPath: requireString(record.repoPath, "repoPath"),
    worktreePath: requireString(record.worktreePath, "worktreePath"),
    force: optionalBoolean(record.force, "force") ?? false,
  };
};

export const parseGitCommitAllInput = (input: JsonValue | undefined): GitCommitAllInput => {
  const record = requireRecord(input, "Git commit input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const message = requireString(record.message, "message");
  const workingDir = optionalString(record.workingDir, "workingDir");

  return workingDir ? { repoPath, message, workingDir } : { repoPath, message };
};

export const parseGitPushBranchInput = (input: JsonValue | undefined): GitPushBranchInput => {
  const record = requireRecord(input, "Git push input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const branch = requireString(record.branch, "branch");
  const remote = optionalString(record.remote, "remote") ?? "origin";
  const workingDir = optionalString(record.workingDir, "workingDir");
  const setUpstream = optionalBoolean(record.setUpstream, "setUpstream");
  const forceWithLease = optionalBoolean(record.forceWithLease, "forceWithLease");

  return {
    repoPath,
    branch,
    remote,
    ...(workingDir ? { workingDir } : undefined),
    ...(setUpstream === undefined ? undefined : { setUpstream }),
    ...(forceWithLease === undefined ? undefined : { forceWithLease }),
  };
};

export const parseGitRebaseBranchInput = (input: JsonValue | undefined): GitRebaseBranchInput => {
  const record = requireRecord(input, "Git rebase input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const targetBranch = requireString(record.targetBranch, "targetBranch");
  const workingDir = optionalString(record.workingDir, "workingDir");

  return workingDir ? { repoPath, targetBranch, workingDir } : { repoPath, targetBranch };
};

export const parseGitAbortConflictInput = (input: JsonValue | undefined): GitAbortConflictInput => {
  const record = requireRecord(input, "Git conflict abort input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const operation = gitConflictOperationSchema.parse(record.operation);
  const workingDir = optionalString(record.workingDir, "workingDir");

  return workingDir ? { repoPath, operation, workingDir } : { repoPath, operation };
};

export const parseGitDiffInput = (input: JsonValue | undefined): GitDiffInput => {
  const record = requireRecord(input, "Git diff input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const targetBranch = optionalString(record.targetBranch, "targetBranch");
  const workingDir = optionalString(record.workingDir, "workingDir");

  return {
    repoPath,
    ...(targetBranch ? { targetBranch } : undefined),
    ...(workingDir ? { workingDir } : undefined),
  };
};

export const parseGitWorktreeStatusInput = (
  input: JsonValue | undefined,
): GitWorktreeStatusInput => {
  const record = requireRecord(input, "Git worktree status input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const targetBranch = requireString(record.targetBranch, "targetBranch");
  const diffScopeValue =
    record.diffScope === undefined || record.diffScope === null ? "target" : record.diffScope;
  const diffScope = gitDiffScopeSchema.safeParse(diffScopeValue);
  if (!diffScope.success) {
    throw new HostValidationError({
      message: `diffScope must be either 'target' or 'uncommitted', got: ${String(diffScopeValue)}`,
      field: "diffScope",
      cause: diffScope.error,
      details: { value: diffScopeValue },
    });
  }
  const workingDir = optionalString(record.workingDir, "workingDir");

  return {
    repoPath,
    targetBranch,
    diffScope: diffScope.data,
    ...(workingDir ? { workingDir } : undefined),
  };
};

export const parseGitResetWorktreeSelectionInput = (
  input: JsonValue | undefined,
): GitResetWorktreeSelectionRequest => gitResetWorktreeSelectionRequestSchema.parse(input);
