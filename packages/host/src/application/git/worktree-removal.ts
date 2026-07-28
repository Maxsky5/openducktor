import { Effect } from "effect";
import { canonicalPathsEqual } from "../../domain/path-comparison";
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
    return { ...resolvedPath, managedBasePath: managedBase, targetExists };
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
const canonicalPathPlatform = process.platform === "win32" ? "windows" : "posix";
const isStableManagedCleanupPath = (
  initial: { canonicalPath: string; cleanupPath: string; kind: "descendant" | "outside" },
  current: {
    canonicalPath: string;
    cleanupPath: string;
    kind: "descendant" | "outside";
    targetExists: boolean;
  },
) =>
  initial.kind === "descendant" &&
  current.kind === "descendant" &&
  canonicalPathsEqual(current.cleanupPath, initial.cleanupPath, canonicalPathPlatform) &&
  (!current.targetExists ||
    canonicalPathsEqual(current.canonicalPath, initial.canonicalPath, canonicalPathPlatform));
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
    if (
      initialCleanup.kind === "outside" &&
      !canonicalPathsEqual(
        initialCleanup.cleanupPath,
        initialCleanup.canonicalPath,
        canonicalPathPlatform,
      )
    ) {
      return yield* Effect.fail(cleanupRefused(effectiveWorktreePath));
    }
    if (
      initialCleanup.kind === "outside" &&
      (initialCleanup.targetExists ||
        (yield* worktreeFiles.pathIsWithinRoot(
          effectiveWorktreePath,
          initialCleanup.managedBasePath,
        )))
    ) {
      const registered = yield* gitPort.isRegisteredWorktree(
        repoPath,
        initialCleanup.canonicalPath,
      );
      if (!registered) {
        return yield* Effect.fail(cleanupRefused(effectiveWorktreePath));
      }
    }
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
    const cleanupIdentityIsStable = isStableManagedCleanupPath(initialCleanup, currentCleanup);
    const missingOutsideCleanup =
      !currentCleanup.targetExists &&
      (initialCleanup.kind === "outside" || currentCleanup.kind === "outside");
    if (
      removalResult._tag === "Right" &&
      initialCleanup.kind === "outside" &&
      !currentCleanup.targetExists
    ) {
      return;
    }
    if (removalResult._tag === "Left") {
      const registered = yield* gitPort.isRegisteredWorktree(
        repoPath,
        initialCleanup.canonicalPath,
      );
      if (registered) {
        return yield* Effect.fail(removalResult.left);
      }
      if (input.missingOutsideManagedRootPathPolicy === "skip" && missingOutsideCleanup) {
        return;
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
      if (input.missingOutsideManagedRootPathPolicy === "skip" && missingOutsideCleanup) {
        return;
      }
      return yield* Effect.fail(
        initialCleanup.kind === "outside" || currentCleanup.kind === "outside"
          ? cleanupRefused(effectiveWorktreePath)
          : cleanupIdentityChanged(effectiveWorktreePath),
      );
    }
    yield* worktreeFiles.removePathIfPresent(currentCleanup.cleanupPath).pipe(
      Effect.mapError(
        (error) =>
          new HostOperationError({
            operation: "git.remove_worktree.cleanup_path",
            message: `git worktree removal left filesystem path cleanup incomplete for ${worktreePath} (canonical cleanup path: ${currentCleanup.cleanupPath})`,
            cause: error,
            details: {
              canonicalPath: currentCleanup.canonicalPath,
              cleanupPath: currentCleanup.cleanupPath,
              worktreePath,
            },
          }),
      ),
    );
  });
