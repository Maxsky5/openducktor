import type {
  RepoConfig,
  WorkspaceSessionArchivePreview,
  WorkspaceSessionExecutionTarget,
} from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import { canonicalTargetBranch, checkoutBranch } from "../../domain/task/task-branch-policy";
import { type HostError, HostOperationError, HostValidationError } from "../../effect/host-errors";
import { runHookCommandsAllowFailure } from "../tasks/support/workflow-hooks";
import {
  validateWorkspaceSessionTarget,
  type WorkspaceSessionTargetDependencies,
} from "./workspace-session-target";

type WorktreeTarget = Extract<WorkspaceSessionExecutionTarget, { kind: "local_worktree" }>;

export const readWorkspaceSessionArchivePreview = (
  dependencies: WorkspaceSessionTargetDependencies,
  config: RepoConfig,
  target: WorktreeTarget,
): Effect.Effect<WorkspaceSessionArchivePreview, HostError> =>
  Effect.gen(function* () {
    const { git, settingsConfig } = dependencies;
    if (target.workingDirectory === config.repoPath) {
      return yield* new HostValidationError({
        field: "workingDirectory",
        message: "Cannot remove the repository checkout as a session worktree.",
      });
    }
    const checkout = yield* git.getCurrentBranch(config.repoPath);
    if (
      target.branchName === checkoutBranch(config.defaultTargetBranch) ||
      target.branchName === checkout.name
    ) {
      return yield* new HostValidationError({
        field: "removeWorktree",
        message: `Cannot delete protected branch ${target.branchName}. Turn off worktree removal to archive this chat.`,
      });
    }
    const worktreeExists = yield* settingsConfig.pathExists(target.workingDirectory);
    if (!worktreeExists) {
      return {
        branchName: target.branchName,
        worktreeExists: false,
        hasUncommittedChanges: false,
      };
    }
    yield* validateWorkspaceSessionTarget(dependencies, config.repoPath, target);
    const current = yield* git.getCurrentBranch(target.workingDirectory);
    if (current.detached || current.name !== target.branchName) {
      return yield* new HostValidationError({
        field: "removeWorktree",
        message: `The worktree is no longer on ${target.branchName}. Switch it back or turn off worktree removal.`,
      });
    }
    const changes = yield* git.getStatus(target.workingDirectory);
    return {
      branchName: target.branchName,
      worktreeExists: true,
      hasUncommittedChanges: changes.length > 0,
    };
  });

export const removeWorkspaceSessionWorktree = (
  { git }: WorkspaceSessionTargetDependencies,
  repoPath: string,
  target: WorktreeTarget,
) =>
  Effect.gen(function* () {
    // An explicit archive retry can finish a previous partial cleanup.
    if (yield* git.isRegisteredWorktree(repoPath, target.workingDirectory)) {
      yield* git.removeWorktree(repoPath, target.workingDirectory, true);
    }
    if (yield* git.referenceExists(repoPath, `refs/heads/${target.branchName}`)) {
      yield* git.deleteLocalBranch(repoPath, target.branchName, true);
    }
    return { ...target, worktreeState: "removed" as const };
  });

export const withRestoredWorkspaceSessionWorktree = <A, E>(
  dependencies: WorkspaceSessionTargetDependencies,
  config: RepoConfig,
  target: WorktreeTarget,
  use: (target: WorktreeTarget) => Effect.Effect<A, E>,
): Effect.Effect<A, E | HostError> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const { git, settingsConfig, worktreeFiles, systemCommands } = dependencies;
      const { repoPath } = config;
      if (
        (yield* settingsConfig.pathExists(target.workingDirectory)) ||
        (yield* git.isRegisteredWorktree(repoPath, target.workingDirectory))
      ) {
        return yield* new HostValidationError({
          field: "workingDirectory",
          message: `Cannot restore into an existing worktree or directory: ${target.workingDirectory}. Move it before retrying.`,
        });
      }
      if (yield* git.referenceExists(repoPath, `refs/heads/${target.branchName}`)) {
        return yield* new HostValidationError({
          field: "branchName",
          message: `Cannot restore because branch ${target.branchName} already exists. Rename it before retrying.`,
        });
      }
      const startPoint = canonicalTargetBranch(config.defaultTargetBranch);
      if (!(yield* git.referenceExists(repoPath, startPoint))) {
        return yield* new HostValidationError({
          field: "defaultTargetBranch",
          message: `Configured default branch ${startPoint} is unavailable. Fetch it or update the repository settings before restoring.`,
        });
      }
      return yield* dependencies.withWorkStartLease(
        repoPath,
        Effect.gen(function* () {
          let acquired = false;
          const result = yield* Effect.exit(
            Effect.gen(function* () {
              yield* git
                .createWorktree(
                  repoPath,
                  target.workingDirectory,
                  target.branchName,
                  true,
                  startPoint,
                )
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new HostOperationError({
                        operation: "workspaceSession.restore.acquire",
                        message: `Git did not confirm worktree creation at ${target.workingDirectory} for branch ${target.branchName}. Inspect the directory and branch before retrying. No automatic cleanup ran.\n${cause.message}`,
                        cause,
                      }),
                  ),
                );
              acquired = true;
              yield* restore(
                Effect.gen(function* () {
                  yield* worktreeFiles.copyConfiguredPaths(
                    repoPath,
                    target.workingDirectory,
                    config.worktreeCopyPaths,
                  );
                  const hookFailure = yield* runHookCommandsAllowFailure(
                    systemCommands,
                    config.hooks.preStart,
                    target.workingDirectory,
                  );
                  if (hookFailure) {
                    return yield* new HostOperationError({
                      operation: "workspaceSession.restore.preStart",
                      message: `Workspace Session pre-start hook failed: ${hookFailure.hook}\n${hookFailure.stderr}`,
                    });
                  }
                  yield* validateWorkspaceSessionTarget(dependencies, repoPath, target);
                }),
              );
              return yield* use({ ...target, worktreeState: "present" });
            }),
          );
          if (Exit.isSuccess(result)) return result.value;
          if (!acquired) return yield* Effect.failCause(result.cause);
          const cleanup = yield* Effect.exit(
            removeWorkspaceSessionWorktree(dependencies, repoPath, target),
          );
          if (Exit.isFailure(cleanup)) {
            return yield* new HostOperationError({
              operation: "workspaceSession.restore.cleanup",
              message: `Workspace Session restore failed: ${Cause.pretty(result.cause)}\nGit cleanup also failed: ${Cause.pretty(cleanup.cause)}`,
              cause: { restore: result.cause, cleanup: cleanup.cause },
            });
          }
          return yield* Effect.failCause(result.cause);
        }),
        target.workingDirectory,
      );
    }),
  );
