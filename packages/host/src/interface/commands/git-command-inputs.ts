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
import {
  commandInputOptionalBooleanSchema,
  commandInputOptionalStringSchema,
  commandInputRecordSchema,
  commandInputStringSchema,
  type HostCommandArgs,
  optionalBoolean,
  optionalString,
  requireParsedRecord,
  requireString,
} from "./command-inputs";

export const parseGitScopeInput = (input: HostCommandArgs): GitScopeInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "Git command input",
  );
  const repoPath = requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath");
  const workingDir = optionalString(
    commandInputOptionalStringSchema.safeParse(record.workingDir),
    "workingDir",
  );

  return workingDir ? { repoPath, workingDir } : { repoPath };
};

export const parseGitAheadBehindInput = (input: HostCommandArgs): GitAheadBehindInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "Git ahead/behind input",
  );
  const repoPath = requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath");
  const targetBranch = requireString(
    commandInputStringSchema.safeParse(record.targetBranch),
    "targetBranch",
  );
  const workingDir = optionalString(
    commandInputOptionalStringSchema.safeParse(record.workingDir),
    "workingDir",
  );

  return workingDir ? { repoPath, targetBranch, workingDir } : { repoPath, targetBranch };
};

export const parseGitSwitchBranchInput = (input: HostCommandArgs): GitSwitchBranchInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "Git switch branch input",
  );
  return {
    repoPath: requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath"),
    branch: requireString(commandInputStringSchema.safeParse(record.branch), "branch"),
    create:
      optionalBoolean(commandInputOptionalBooleanSchema.safeParse(record.create), "create") ??
      false,
  };
};

export const parseGitCreateWorktreeInput = (input: HostCommandArgs): GitCreateWorktreeInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "Git create worktree input",
  );
  return {
    repoPath: requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath"),
    worktreePath: requireString(
      commandInputStringSchema.safeParse(record.worktreePath),
      "worktreePath",
    ),
    branch: requireString(commandInputStringSchema.safeParse(record.branch), "branch"),
    createBranch:
      optionalBoolean(
        commandInputOptionalBooleanSchema.safeParse(record.createBranch),
        "createBranch",
      ) ?? false,
  };
};

export const parseGitRemoveWorktreeInput = (input: HostCommandArgs): GitRemoveWorktreeInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "Git remove worktree input",
  );
  return {
    repoPath: requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath"),
    worktreePath: requireString(
      commandInputStringSchema.safeParse(record.worktreePath),
      "worktreePath",
    ),
    force:
      optionalBoolean(commandInputOptionalBooleanSchema.safeParse(record.force), "force") ?? false,
  };
};

export const parseGitCommitAllInput = (input: HostCommandArgs): GitCommitAllInput => {
  const record = requireParsedRecord(commandInputRecordSchema.safeParse(input), "Git commit input");
  const repoPath = requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath");
  const message = requireString(commandInputStringSchema.safeParse(record.message), "message");
  const workingDir = optionalString(
    commandInputOptionalStringSchema.safeParse(record.workingDir),
    "workingDir",
  );

  return workingDir ? { repoPath, message, workingDir } : { repoPath, message };
};

export const parseGitPushBranchInput = (input: HostCommandArgs): GitPushBranchInput => {
  const record = requireParsedRecord(commandInputRecordSchema.safeParse(input), "Git push input");
  const repoPath = requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath");
  const branch = requireString(commandInputStringSchema.safeParse(record.branch), "branch");
  const remote =
    optionalString(commandInputOptionalStringSchema.safeParse(record.remote), "remote") ?? "origin";
  const workingDir = optionalString(
    commandInputOptionalStringSchema.safeParse(record.workingDir),
    "workingDir",
  );
  const setUpstream = optionalBoolean(
    commandInputOptionalBooleanSchema.safeParse(record.setUpstream),
    "setUpstream",
  );
  const forceWithLease = optionalBoolean(
    commandInputOptionalBooleanSchema.safeParse(record.forceWithLease),
    "forceWithLease",
  );

  const result: GitPushBranchInput = {
    repoPath,
    branch,
    remote,
  };
  if (workingDir) {
    result.workingDir = workingDir;
  }
  if (setUpstream !== undefined) {
    result.setUpstream = setUpstream;
  }
  if (forceWithLease !== undefined) {
    result.forceWithLease = forceWithLease;
  }
  return result;
};

export const parseGitRebaseBranchInput = (input: HostCommandArgs): GitRebaseBranchInput => {
  const record = requireParsedRecord(commandInputRecordSchema.safeParse(input), "Git rebase input");
  const repoPath = requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath");
  const targetBranch = requireString(
    commandInputStringSchema.safeParse(record.targetBranch),
    "targetBranch",
  );
  const workingDir = optionalString(
    commandInputOptionalStringSchema.safeParse(record.workingDir),
    "workingDir",
  );

  return workingDir ? { repoPath, targetBranch, workingDir } : { repoPath, targetBranch };
};

export const parseGitAbortConflictInput = (input: HostCommandArgs): GitAbortConflictInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "Git conflict abort input",
  );
  const repoPath = requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath");
  const operation = gitConflictOperationSchema.parse(record.operation);
  const workingDir = optionalString(
    commandInputOptionalStringSchema.safeParse(record.workingDir),
    "workingDir",
  );

  return workingDir ? { repoPath, operation, workingDir } : { repoPath, operation };
};

export const parseGitDiffInput = (input: HostCommandArgs): GitDiffInput => {
  const record = requireParsedRecord(commandInputRecordSchema.safeParse(input), "Git diff input");
  const repoPath = requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath");
  const targetBranch = optionalString(
    commandInputOptionalStringSchema.safeParse(record.targetBranch),
    "targetBranch",
  );
  const workingDir = optionalString(
    commandInputOptionalStringSchema.safeParse(record.workingDir),
    "workingDir",
  );

  const result: GitDiffInput = { repoPath };
  if (targetBranch) {
    result.targetBranch = targetBranch;
  }
  if (workingDir) {
    result.workingDir = workingDir;
  }
  return result;
};

export const parseGitWorktreeStatusInput = (input: HostCommandArgs): GitWorktreeStatusInput => {
  const record = requireParsedRecord(
    commandInputRecordSchema.safeParse(input),
    "Git worktree status input",
  );
  const repoPath = requireString(commandInputStringSchema.safeParse(record.repoPath), "repoPath");
  const targetBranch = requireString(
    commandInputStringSchema.safeParse(record.targetBranch),
    "targetBranch",
  );
  const diffScopeValue =
    record.diffScope === undefined || record.diffScope === null ? "target" : record.diffScope;
  const diffScope = gitDiffScopeSchema.safeParse(diffScopeValue);
  if (!diffScope.success) {
    throw new HostValidationError({
      message: `diffScope must be either 'target' or 'uncommitted', got: ${String(diffScopeValue)}`,
      field: "diffScope",
      cause: diffScope.error,
    });
  }
  const workingDir = optionalString(
    commandInputOptionalStringSchema.safeParse(record.workingDir),
    "workingDir",
  );

  const result: GitWorktreeStatusInput = {
    repoPath,
    targetBranch,
    diffScope: diffScope.data,
  };
  if (workingDir) {
    result.workingDir = workingDir;
  }
  return result;
};

export const parseGitResetWorktreeSelectionInput = (
  input: HostCommandArgs,
): GitResetWorktreeSelectionRequest => gitResetWorktreeSelectionRequestSchema.parse(input);
