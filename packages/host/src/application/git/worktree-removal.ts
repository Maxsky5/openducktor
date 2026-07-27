import { pathStartsWith, toProjectRelativePath } from "@openducktor/path-support";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import { findRepoConfigByPath } from "./git-service-inputs";
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
const resolveFilesystemCleanup = (
  { settingsConfig, worktreeFiles }: RemoveWorktreeAndFilesystemPathDependencies,
  input: Pick<
    RemoveWorktreeAndFilesystemPathInput,
    "managedWorktreeBasePath" | "missingOutsideManagedRootPathPolicy" | "repoPath"
  >,
  effectiveWorktreePath: string,
  targetExists: boolean,
  cause?: unknown,
) =>
  Effect.gen(function* () {
    const managedBase =
      input.managedWorktreeBasePath ??
      (yield* managedWorktreeBasePath(settingsConfig, input.repoPath));
    const insideManagedBase = targetExists
      ? yield* worktreeFiles.pathIsWithinRoot(managedBase, effectiveWorktreePath)
      : pathStartsWith(effectiveWorktreePath, managedBase);
    if (insideManagedBase) {
      return {
        kind: "cleanup-filesystem-path" as const,
        managedBase,
      };
    }
    if (input.missingOutsideManagedRootPathPolicy === "skip" && !targetExists) {
      return { kind: "skip-filesystem-cleanup" as const };
    }
    return yield* Effect.fail(
      new HostValidationError({
        message: `Refusing worktree cleanup outside managed roots for ${effectiveWorktreePath}`,
        cause,
      }),
    );
  });
export const removeWorktreeAndFilesystemPath = (
  dependencies: RemoveWorktreeAndFilesystemPathDependencies,
  input: RemoveWorktreeAndFilesystemPathInput,
) =>
  Effect.gen(function* () {
    const { gitPort, settingsConfig, worktreeFiles } = dependencies;
    const { repoPath, worktreePath, force } = input;
    const effectiveWorktreePath = worktreeFiles.resolveWorktreePath(repoPath, worktreePath);
    if (yield* worktreeFiles.pathIsWithinRoot(effectiveWorktreePath, repoPath)) {
      return yield* Effect.fail(
        new HostValidationError({
          message: "worktree path cannot be the repository root",
        }),
      );
    }
    const removalResult = yield* Effect.either(
      gitPort.removeWorktree(repoPath, worktreePath, force),
    );
    if (removalResult._tag === "Left" && !force) {
      return yield* Effect.fail(removalResult.left);
    }
    const targetExists = yield* settingsConfig.pathExists(effectiveWorktreePath);
    const filesystemCleanup = yield* Effect.either(
      resolveFilesystemCleanup(
        dependencies,
        input,
        effectiveWorktreePath,
        targetExists,
        removalResult._tag === "Left" ? removalResult.left : undefined,
      ),
    );
    if (removalResult._tag === "Left") {
      let registrationPath = effectiveWorktreePath;
      let registrationIdentityProved = false;
      if (targetExists) {
        registrationPath = yield* gitPort.canonicalizePath(effectiveWorktreePath);
        registrationIdentityProved = true;
      } else if (
        filesystemCleanup._tag === "Right" &&
        filesystemCleanup.right.kind === "cleanup-filesystem-path"
      ) {
        const canonicalManagedBase = yield* gitPort.canonicalizePath(
          filesystemCleanup.right.managedBase,
        );
        registrationPath = settingsConfig.join(
          canonicalManagedBase,
          toProjectRelativePath(effectiveWorktreePath, filesystemCleanup.right.managedBase),
        );
        registrationIdentityProved = true;
      }
      const registered = yield* gitPort.isRegisteredWorktree(repoPath, registrationPath);
      if (registered || !registrationIdentityProved) {
        return yield* Effect.fail(removalResult.left);
      }
    }
    if (filesystemCleanup._tag === "Left") {
      return yield* Effect.fail(filesystemCleanup.left);
    }
    if (filesystemCleanup.right.kind === "skip-filesystem-cleanup") {
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
