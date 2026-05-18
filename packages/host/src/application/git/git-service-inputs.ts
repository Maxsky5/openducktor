import type { GitConflictOperation, GitDiffScope, GlobalConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostDependencyError, HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
export type CreateGitServiceInput = {
  gitPort: GitPort;
  settingsConfig?: SettingsConfigPort;
  worktreeFiles?: WorktreeFilePort;
};
export type GitScopeInput = {
  repoPath: string;
  workingDir?: string;
};
export type GitAheadBehindInput = GitScopeInput & {
  targetBranch: string;
};
export type GitSwitchBranchInput = {
  branch: string;
  create: boolean;
  repoPath: string;
};
export type GitCreateWorktreeInput = {
  branch: string;
  createBranch: boolean;
  repoPath: string;
  worktreePath: string;
};
export type GitRemoveWorktreeInput = {
  force: boolean;
  repoPath: string;
  worktreePath: string;
};
export type GitCommitAllInput = GitScopeInput & {
  message: string;
};
export type GitPushBranchInput = GitScopeInput & {
  branch: string;
  forceWithLease?: boolean;
  remote: string;
  setUpstream?: boolean;
};
export type GitRebaseBranchInput = GitScopeInput & {
  targetBranch: string;
};
export type GitAbortConflictInput = GitScopeInput & {
  operation: GitConflictOperation;
};
export type GitDiffInput = GitScopeInput & {
  targetBranch?: string;
};
export type GitWorktreeStatusInput = GitScopeInput & {
  diffScope: GitDiffScope;
  targetBranch: string;
};
export const resolveGitWorkingDirectory = (
  gitPort: GitPort,
  repoPath: string,
  workingDir: string | undefined,
) =>
  Effect.gen(function* () {
    const canonicalRepoPath = yield* gitPort.canonicalizePath(repoPath).pipe(
      Effect.mapError(
        (error) =>
          new HostValidationError({
            message: `repo_path does not exist or is not accessible: ${repoPath}`,
            field: "repoPath",
            cause: error,
          }),
      ),
    );
    if (!(yield* gitPort.isGitRepository(canonicalRepoPath))) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `Not a git repository: ${canonicalRepoPath}`,
          field: "repoPath",
        }),
      );
    }
    if (!workingDir || workingDir === repoPath) {
      return canonicalRepoPath;
    }
    const canonicalWorkingDir = yield* gitPort.canonicalizePath(workingDir).pipe(
      Effect.mapError(
        (error) =>
          new HostValidationError({
            message: `working_dir does not exist or is not accessible: ${workingDir}`,
            field: "workingDir",
            cause: error,
          }),
      ),
    );
    if (canonicalWorkingDir === canonicalRepoPath) {
      return canonicalWorkingDir;
    }
    if (!(yield* gitPort.isGitRepository(canonicalWorkingDir))) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `Not a git repository: ${canonicalWorkingDir}`,
          field: "workingDir",
        }),
      );
    }
    if (!(yield* gitPort.shareGitCommonDirectory(canonicalRepoPath, canonicalWorkingDir))) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `working_dir is not within authorized repository or linked worktrees: ${workingDir}`,
          field: "workingDir",
        }),
      );
    }
    return canonicalWorkingDir;
  });
export const requireGlobalConfig = (payload: GlobalConfig | null): GlobalConfig => {
  if (payload === null) {
    throw new HostValidationError({
      message: "No OpenDucktor workspace config is available for git worktree mutation.",
    });
  }
  return payload;
};
export const findRepoConfigByPath = (
  settingsConfig: SettingsConfigPort,
  canonicalRepoPath: string,
) =>
  Effect.gen(function* () {
    const config = requireGlobalConfig(yield* settingsConfig.readConfig());
    for (const repoConfig of Object.values(config.workspaces)) {
      const configuredRepoPath = yield* settingsConfig.canonicalizePath(repoConfig.repoPath);
      if (configuredRepoPath === canonicalRepoPath) {
        return repoConfig;
      }
    }
    return yield* Effect.fail(
      new HostValidationError({
        message: `Repository is not registered in OpenDucktor settings: ${canonicalRepoPath}`,
        field: "repoPath",
      }),
    );
  });
export const isDefinitiveNonWorktreeGitError = (error: unknown): boolean => {
  const errorText = String(error instanceof Error ? error.message : error).toLowerCase();
  return [
    "not a git repository",
    "not a git worktree",
    "not a working tree",
    "is not a working tree",
  ].some((needle) => errorText.includes(needle));
};
export const requireSettingsConfig = (
  settingsConfig: SettingsConfigPort | undefined,
): SettingsConfigPort => {
  if (!settingsConfig) {
    throw new HostDependencyError({
      dependency: "settingsConfig",
      operation: "git.worktree_mutation",
      message: "Settings config port is required for git worktree mutation commands.",
    });
  }
  return settingsConfig;
};
export const requireWorktreeFiles = (
  worktreeFiles: WorktreeFilePort | undefined,
): WorktreeFilePort => {
  if (!worktreeFiles) {
    throw new HostDependencyError({
      dependency: "worktreeFiles",
      operation: "git.worktree_mutation",
      message: "Worktree file port is required for git worktree mutation commands.",
    });
  }
  return worktreeFiles;
};
export const cleanupFailedCreatedWorktree = (
  gitPort: GitPort,
  repoPath: string,
  worktreePath: string,
  branch: string,
  deleteBranch: boolean,
) =>
  Effect.gen(function* () {
    const cleanupErrors: string[] = [];
    yield* gitPort.removeWorktree(repoPath, worktreePath, true).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          cleanupErrors.push(`Also failed to remove worktree: ${String(error)}`);
        }),
      ),
    );
    if (deleteBranch) {
      yield* gitPort.deleteLocalBranch(repoPath, branch, true).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            cleanupErrors.push(`Also failed to delete created branch ${branch}: ${String(error)}`);
          }),
        ),
      );
    }
    return cleanupErrors.length > 0 ? `\n${cleanupErrors.join("\n")}` : "";
  });
export const normalizeCreateGitServiceInput = (
  input: GitPort | CreateGitServiceInput,
): CreateGitServiceInput =>
  "gitPort" in input
    ? input
    : {
        gitPort: input,
      };
