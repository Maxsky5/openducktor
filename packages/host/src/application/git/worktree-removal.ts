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
const inspectFilesystemCleanup = (
  { settingsConfig, worktreeFiles }: RemoveWorktreeAndFilesystemPathDependencies,
  input: Pick<RemoveWorktreeAndFilesystemPathInput, "managedWorktreeBasePath" | "repoPath">,
  effectiveWorktreePath: string,
) =>
  Effect.gen(function* () {
    const managedBase =
      input.managedWorktreeBasePath ??
      (yield* managedWorktreeBasePath(settingsConfig, input.repoPath));
    const [targetExists, resolvedPath] = yield* Effect.all([
      settingsConfig.pathExists(effectiveWorktreePath),
      worktreeFiles.resolvePathWithinRoot(managedBase, effectiveWorktreePath),
    ]);
    return { ...resolvedPath, targetExists };
  });
const cleanupRefused = (effectiveWorktreePath: string, cause?: unknown) =>
  new HostValidationError({
    message: `Refusing worktree cleanup outside managed roots for ${effectiveWorktreePath}`,
    cause,
  });
const cleanupIdentityChanged = (effectiveWorktreePath: string, cause?: unknown) =>
  new HostValidationError({
    message: `Refusing worktree cleanup because its filesystem identity changed for ${effectiveWorktreePath}`,
    cause,
  });
const hasStableManagedIdentity = (
  initial: { canonicalPath: string; kind: "descendant" | "outside" },
  current: { canonicalPath: string; kind: "descendant" | "outside" },
) =>
  initial.kind === "descendant" &&
  current.kind === "descendant" &&
  current.canonicalPath === initial.canonicalPath;
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
    const initialCleanup = yield* inspectFilesystemCleanup(
      dependencies,
      input,
      effectiveWorktreePath,
    );
    const removalResult = yield* Effect.either(
      gitPort.removeWorktree(repoPath, worktreePath, force),
    );
    if (removalResult._tag === "Left" && !force) {
      return yield* Effect.fail(removalResult.left);
    }
    const currentCleanup = yield* inspectFilesystemCleanup(
      dependencies,
      input,
      effectiveWorktreePath,
    );
    const cleanupIdentityIsStable = hasStableManagedIdentity(initialCleanup, currentCleanup);
    if (removalResult._tag === "Left") {
      const registered = yield* gitPort.isRegisteredWorktree(
        repoPath,
        initialCleanup.canonicalPath,
      );
      if (registered) {
        return yield* Effect.fail(removalResult.left);
      }
      if (initialCleanup.kind === "outside") {
        return yield* Effect.fail(
          initialCleanup.targetExists
            ? cleanupRefused(effectiveWorktreePath, removalResult.left)
            : removalResult.left,
        );
      }
      if (!cleanupIdentityIsStable) {
        return yield* Effect.fail(removalResult.left);
      }
    }
    if (!cleanupIdentityIsStable) {
      if (input.missingOutsideManagedRootPathPolicy === "skip" && !currentCleanup.targetExists) {
        return;
      }
      return yield* Effect.fail(
        currentCleanup.canonicalPath === initialCleanup.canonicalPath
          ? cleanupRefused(effectiveWorktreePath)
          : cleanupIdentityChanged(effectiveWorktreePath),
      );
    }
    yield* worktreeFiles.removePathIfPresent(currentCleanup.canonicalPath).pipe(
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
