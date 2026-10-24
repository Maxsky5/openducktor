import type { RepoConfig, TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import { classifyWorkspaceCheckout } from "../../git/workspace-checkout";
import type { requireBuildStartDependencies } from "./required-task-dependencies";
import { effectiveTargetBranchForTask, resolveBuildStartPoint } from "./task-worktree-cleanup";
import {
  failOperationAfterRollback,
  rollbackFailedTaskWorktree,
  type TaskStartRollbackError,
} from "./task-worktree-rollback";

type BuildStartDependencies = ReturnType<typeof requireBuildStartDependencies>;

export type PreparedTaskWorktree = {
  rollback: () => Effect.Effect<void, TaskStartRollbackError>;
  worktreePath: string;
};

export const validateExistingGitTaskWorktree = (
  dependencies: Pick<BuildStartDependencies, "gitPort">,
  canonicalRepoPath: string,
  worktreePath: string,
  taskId: string,
) =>
  Effect.gen(function* () {
    const [canonicalWorktreePath, canonicalRepositoryPath] = yield* Effect.all([
      dependencies.gitPort.canonicalizePath(worktreePath),
      dependencies.gitPort.canonicalizePath(canonicalRepoPath),
    ]);
    const checkout = yield* classifyWorkspaceCheckout(dependencies.gitPort, {
      canonicalRepoPath: canonicalRepositoryPath,
      canonicalDirectory: canonicalWorktreePath,
    });
    if (checkout === "local_worktree") return;
    const message = {
      local_repo_root: `Canonical worktree for task ${taskId} resolves to the repository root.`,
      not_git_directory: `Canonical task worktree path exists but is not a Git worktree: ${worktreePath}`,
      outside_workspace: `Existing canonical path is not a registered worktree for task ${taskId}: ${worktreePath}`,
    }[checkout];
    return yield* Effect.fail(
      new HostValidationError({
        field: "taskId",
        message,
        details: { repoPath: canonicalRepoPath, taskId, worktreePath },
      }),
    );
  });

export const prepareNewTaskWorktree = (
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
    let createdTaskWorktree = false;
    const actionRun = dependencies.worktreeActions.createRun({ worktreePath, branch });
    const rollback = (): Effect.Effect<void, TaskStartRollbackError> =>
      Effect.gen(function* () {
        if (!createdTaskWorktree) return;
        yield* actionRun.stopTerminals();
        yield* rollbackFailedTaskWorktree(
          dependencies,
          canonicalRepoPath,
          worktreePath,
          branch,
          createdTrackingRef,
          worktreeBase,
        );
      });
    const setupResult = yield* Effect.result(
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
        createdTaskWorktree = true;

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

        yield* actionRun.run({
          context: { repoPath: canonicalRepoPath, taskId: task.id },
          actions: repoConfig.actions,
        });
      }).pipe(
        // An interrupted setup has no caller that holds this rollback yet.
        Effect.onInterrupt(() => rollback().pipe(Effect.orDie)),
      ),
    );

    if (setupResult._tag === "Failure") {
      return yield* failOperationAfterRollback(rollback(), setupResult.failure, {
        operation: "task.build_start.prepare_worktree",
        details: { repoPath: canonicalRepoPath, taskId: task.id, worktreePath },
      });
    }

    return { rollback, worktreePath } satisfies PreparedTaskWorktree;
  });
