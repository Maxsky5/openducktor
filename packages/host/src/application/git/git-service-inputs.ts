import type {
  GitCurrentBranch,
  GitReadContext,
  GitConflictOperation,
  GitDiffScope,
  GitTargetBranch,
  GlobalConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostDependencyError, HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import { readWorkspaceCheckout } from "./workspace-checkout";
export type CreateGitServiceInput = {
  gitPort: GitPort;
  settingsConfig?: SettingsConfigPort;
  worktreeFiles?: WorktreeFilePort;
};
export type GitScopeInput = {
  readContext?: GitReadContext;
  repoPath: string;
  workingDir?: string;
};
export type GitAheadBehindInput = GitScopeInput & {
  targetBranch: string;
};
export type GitComparisonTargetInput = GitScopeInput & { target: GitTargetBranch };
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
  expectedBranch?: GitCurrentBranch;
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
export const validateWorktreePathSegments = (
  worktreePath: string,
): Effect.Effect<void, HostValidationError> => {
  const segments =
    process.platform === "win32" ? worktreePath.split(/[\\/]/) : worktreePath.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return Effect.fail(
      new HostValidationError({
        message: "worktree path cannot contain '.' or '..' segments",
        field: "worktreePath",
      }),
    );
  }
  return Effect.void;
};
/**
 * Resolves the directory of a Git request. The directory can be inside the repository checkout or
 * inside a registered worktree of the repository.
 */
export const resolveGitWorkingDirectory = (
  gitPort: GitPort,
  repoPath: string,
  workingDir: string | undefined,
  readContext?: GitReadContext,
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
    const canonicalWorkingDir =
      !workingDir || workingDir === repoPath
        ? canonicalRepoPath
        : yield* gitPort.canonicalizePath(workingDir).pipe(
            Effect.mapError(
              (error) =>
                new HostValidationError({
                  message: `working_dir does not exist or is not accessible: ${workingDir}`,
                  field: "workingDir",
                  cause: error,
                }),
            ),
          );
    const checkout = yield* readWorkspaceCheckout(
      gitPort,
      { canonicalRepoPath, canonicalDirectory: canonicalWorkingDir },
      readContext,
    );
    switch (checkout.kind) {
      case "repository_checkout":
      case "worktree":
        return canonicalWorkingDir;
      case "repository_missing":
        return yield* notGitRepository(canonicalRepoPath, "repoPath");
      case "not_git_directory":
        return yield* notGitRepository(canonicalWorkingDir, "workingDir");
      case "other_repository":
        return yield* new HostValidationError({
          message: `working_dir is not within authorized repository or linked worktrees: ${workingDir}`,
          field: "workingDir",
        });
      case "unlisted_worktree":
        return yield* new HostValidationError({
          message: `working_dir is in a checkout that Git no longer lists as a worktree of the repository: ${workingDir}. If you moved this worktree, run git worktree repair in it and retry.`,
          field: "workingDir",
        });
    }
  });
const notGitRepository = (directory: string, field: "repoPath" | "workingDir") =>
  Effect.fail(new HostValidationError({ message: `Not a git repository: ${directory}`, field }));
const requireGlobalConfig = (
  payload: GlobalConfig | null,
): Effect.Effect<GlobalConfig, HostValidationError> => {
  if (payload === null) {
    return Effect.fail(
      new HostValidationError({
        message: "No OpenDucktor workspace config is available for git worktree mutation.",
      }),
    );
  }
  return Effect.succeed(payload);
};
export const findRepoConfigByPath = (
  settingsConfig: Pick<SettingsConfigPort, "readConfig">,
  canonicalRepoPath: string,
) =>
  Effect.gen(function* () {
    const config = yield* requireGlobalConfig(yield* settingsConfig.readConfig());
    const repoConfig = Object.values(config.workspaces).find(
      (workspace) => workspace.repoPath === canonicalRepoPath,
    );
    if (repoConfig) return repoConfig;
    return yield* Effect.fail(
      new HostValidationError({
        message: `Repository is not registered in OpenDucktor settings: ${canonicalRepoPath}`,
        field: "repoPath",
      }),
    );
  });
export const requireSettingsConfig = (
  settingsConfig: SettingsConfigPort | undefined,
): Effect.Effect<SettingsConfigPort, HostDependencyError> => {
  if (!settingsConfig) {
    return Effect.fail(
      new HostDependencyError({
        dependency: "settingsConfig",
        operation: "git.worktree_mutation",
        message: "Settings config port is required for git worktree mutation commands.",
      }),
    );
  }
  return Effect.succeed(settingsConfig);
};
export const requireWorktreeFiles = (
  worktreeFiles: WorktreeFilePort | undefined,
): Effect.Effect<WorktreeFilePort, HostDependencyError> => {
  if (!worktreeFiles) {
    return Effect.fail(
      new HostDependencyError({
        dependency: "worktreeFiles",
        operation: "git.worktree_mutation",
        message: "Worktree file port is required for git worktree mutation commands.",
      }),
    );
  }
  return Effect.succeed(worktreeFiles);
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
      Effect.catch((error) =>
        Effect.sync(() => {
          cleanupErrors.push(`Also failed to remove worktree: ${String(error)}`);
        }),
      ),
    );
    if (deleteBranch) {
      yield* gitPort.deleteLocalBranch(repoPath, branch, true).pipe(
        Effect.catch((error) =>
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
