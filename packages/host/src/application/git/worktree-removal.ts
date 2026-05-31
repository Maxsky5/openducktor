import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import { findRepoConfigByPath, isDefinitiveNonWorktreeGitError } from "./git-service-inputs";
export type RemoveWorktreeAndFilesystemPathInput = {
  force: boolean;
  managedWorktreeBasePath?: string;
  missingOutsideManagedRootPathPolicy: "fail" | "skip";
  repoPath: string;
  worktreePath: string;
};
export type RemoveWorktreeAndFilesystemPathDependencies = {
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  worktreeFiles: WorktreeFilePort;
};
const managedWorktreeBasePath = (settingsConfig: SettingsConfigPort, canonicalRepoPath: string) =>
  Effect.map(findRepoConfigByPath(settingsConfig, canonicalRepoPath), (repoConfig) =>
    repoConfig.worktreeBasePath !== undefined
      ? settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
      : settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId),
  );
const resolveForcedFilesystemCleanup = (
  { settingsConfig, worktreeFiles }: RemoveWorktreeAndFilesystemPathDependencies,
  input: Pick<
    RemoveWorktreeAndFilesystemPathInput,
    "managedWorktreeBasePath" | "missingOutsideManagedRootPathPolicy" | "repoPath"
  >,
  effectiveWorktreePath: string,
  cause: unknown,
) =>
  Effect.gen(function* () {
    const managedBase =
      input.managedWorktreeBasePath ??
      (yield* managedWorktreeBasePath(settingsConfig, input.repoPath));
    const insideRepo = yield* worktreeFiles.pathIsWithinRoot(input.repoPath, effectiveWorktreePath);
    const insideManagedBase = yield* worktreeFiles.pathIsWithinRoot(
      managedBase,
      effectiveWorktreePath,
    );
    if (insideRepo || insideManagedBase) {
      return "cleanup-filesystem-path" as const;
    }
    if (
      input.missingOutsideManagedRootPathPolicy === "skip" &&
      !(yield* settingsConfig.pathExists(effectiveWorktreePath))
    ) {
      return "skip-filesystem-cleanup" as const;
    }
    return yield* Effect.fail(
      new HostValidationError({
        message: `Refusing forced worktree cleanup outside managed roots for ${effectiveWorktreePath}`,
        cause,
      }),
    );
  });
export const removeWorktreeAndFilesystemPath = (
  dependencies: RemoveWorktreeAndFilesystemPathDependencies,
  input: RemoveWorktreeAndFilesystemPathInput,
) =>
  Effect.gen(function* () {
    const { gitPort, worktreeFiles } = dependencies;
    const { repoPath, worktreePath, force } = input;
    const effectiveWorktreePath = worktreeFiles.resolveWorktreePath(repoPath, worktreePath);
    if (yield* worktreeFiles.pathIsWithinRoot(effectiveWorktreePath, repoPath)) {
      return yield* Effect.fail(
        new HostValidationError({
          message: "worktree path cannot be the repository root",
        }),
      );
    }
    const filesystemCleanup = yield* gitPort.removeWorktree(repoPath, worktreePath, force).pipe(
      Effect.as("cleanup-filesystem-path" as const),
      Effect.catchAll((error) => {
        if (!force || !isDefinitiveNonWorktreeGitError(error)) {
          return Effect.fail(error);
        }
        return resolveForcedFilesystemCleanup(dependencies, input, effectiveWorktreePath, error);
      }),
    );
    if (filesystemCleanup === "skip-filesystem-cleanup") {
      return;
    }
    yield* worktreeFiles.removePathIfPresent(effectiveWorktreePath).pipe(
      Effect.mapError(
        (error) =>
          new HostOperationError({
            operation: "git.remove_worktree.cleanup_path",
            message: `git worktree removal left filesystem path cleanup incomplete for ${worktreePath}`,
            cause: error,
          }),
      ),
    );
  });
