import type { RepoConfig, TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { errorMessage, HostOperationError, HostValidationError } from "../../../effect/host-errors";
import {
  effectiveTargetBranchForTask,
  resolveBuildStartPoint,
  rollbackFailedBuildWorktree,
} from "./builder-worktree-cleanup";
import type { requireBuildStartDependencies } from "./required-task-dependencies";
import { runHookCommandsAllowFailure } from "./workflow-hooks";

type BuildStartDependencies = ReturnType<typeof requireBuildStartDependencies>;

export type PreparedBuildWorktree = {
  cleanup: () => ReturnType<typeof rollbackFailedBuildWorktree>;
  worktreePath: string;
};

export const validateExistingGitBuildWorktree = (
  dependencies: Pick<BuildStartDependencies, "gitPort">,
  canonicalRepoPath: string,
  worktreePath: string,
  taskId: string,
  branch: string,
) =>
  Effect.gen(function* () {
    const [canonicalWorktreePath, canonicalRepositoryPath] = yield* Effect.all([
      dependencies.gitPort.canonicalizePath(worktreePath),
      dependencies.gitPort.canonicalizePath(canonicalRepoPath),
    ]);
    if (canonicalWorktreePath === canonicalRepositoryPath) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Canonical worktree for task ${taskId} resolves to the repository root.`,
          details: { repoPath: canonicalRepoPath, taskId, worktreePath },
        }),
      );
    }
    const sharesGitCommonDirectory = yield* dependencies.gitPort.shareGitCommonDirectory(
      canonicalRepoPath,
      worktreePath,
    );
    if (!sharesGitCommonDirectory) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Existing worktree path does not belong to repository ${canonicalRepoPath}: ${worktreePath}`,
          details: { repoPath: canonicalRepoPath, taskId, worktreePath },
        }),
      );
    }

    if (
      !(yield* dependencies.gitPort.isRegisteredWorktree(canonicalRepoPath, canonicalWorktreePath))
    ) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Existing canonical path is not a registered worktree for task ${taskId}: ${worktreePath}`,
          details: { repoPath: canonicalRepoPath, taskId, worktreePath },
        }),
      );
    }

    const currentBranch = yield* dependencies.gitPort.getCurrentBranch(worktreePath);
    if (currentBranch.detached || currentBranch.name !== branch) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "taskId",
          message: `Existing worktree for task ${taskId} is on ${currentBranch.name ?? "a detached HEAD"} instead of ${branch}.`,
          details: {
            taskId,
            worktreePath,
            expectedBranch: branch,
            actualBranch: currentBranch.name ?? null,
          },
        }),
      );
    }
  });

export const prepareNewBuildWorktree = (
  dependencies: BuildStartDependencies,
  repoConfig: RepoConfig,
  task: TaskCard,
  canonicalRepoPath: string,
  worktreeBase: string,
  worktreePath: string,
  branch: string,
) =>
  Effect.gen(function* () {
    yield* dependencies.worktreeFiles.ensureDirectory(worktreeBase);

    let createdTrackingRef: string | null = null;
    let createdBuildWorktree = false;
    const cleanup = (): ReturnType<typeof rollbackFailedBuildWorktree> =>
      createdBuildWorktree
        ? rollbackFailedBuildWorktree(
            dependencies,
            canonicalRepoPath,
            worktreePath,
            branch,
            createdTrackingRef,
          )
        : Effect.succeed("");
    const setupResult = yield* Effect.either(
      Effect.gen(function* () {
        const targetBranch = yield* effectiveTargetBranchForTask(
          dependencies.workspaceSettingsService,
          task,
          canonicalRepoPath,
        );
        const startPoint = yield* resolveBuildStartPoint(
          dependencies,
          canonicalRepoPath,
          targetBranch,
          task.targetBranch === undefined,
        );
        yield* dependencies.gitPort.createWorktree(
          canonicalRepoPath,
          worktreePath,
          branch,
          true,
          startPoint.reference,
        );
        createdBuildWorktree = true;

        if (startPoint.upstreamRemote) {
          const upstreamSetup = yield* dependencies.gitPort.configureBranchUpstream(
            canonicalRepoPath,
            worktreePath,
            branch,
            startPoint.upstreamRemote,
          );
          createdTrackingRef = upstreamSetup.createdTrackingRef;
        }

        yield* dependencies.worktreeFiles.copyConfiguredPaths(
          canonicalRepoPath,
          worktreePath,
          repoConfig.worktreeCopyPaths,
        );

        const preStartHooks = repoConfig.hooks.preStart.map((hook) => hook.trim()).filter(Boolean);
        const failure = yield* runHookCommandsAllowFailure(
          dependencies.systemCommands,
          preStartHooks,
          worktreePath,
        );
        if (failure) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskId",
              message: `Worktree setup script command failed: ${failure.hook}\n${failure.stderr}`,
              details: { taskId: task.id, hook: failure.hook },
            }),
          );
        }
      }),
    );

    if (setupResult._tag === "Left") {
      const cleanupError = yield* cleanup();
      return yield* Effect.fail(
        new HostOperationError({
          operation: "task.build_start.prepare_worktree",
          message: `${errorMessage(setupResult.left)}${cleanupError}`,
          cause: setupResult.left,
          details: { repoPath: canonicalRepoPath, taskId: task.id, worktreePath },
        }),
      );
    }

    return { cleanup, worktreePath } satisfies PreparedBuildWorktree;
  });
