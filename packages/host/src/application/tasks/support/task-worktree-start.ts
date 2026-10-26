import type { RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import { classifyWorkspaceCheckout } from "../../git/workspace-checkout";
import { startupStep, updateStartup } from "../../agent-sessions/session-startup-progress";
import { worktreeActionStep } from "../../actions/worktree-action-runner";
import type { requireBuildStartDependencies } from "./required-task-dependencies";
import { effectiveTargetBranchForTask, resolveBuildStartPoint } from "./task-worktree-cleanup";
import {
  failOperationAfterRollback,
  rollbackFailedTaskWorktree,
  type TaskStartRollbackError,
} from "./task-worktree-rollback";
import type { TaskRecord } from "../../../ports/task-repository-ports";

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
  task: TaskRecord,
  canonicalRepoPath: string,
  worktreeBase: string,
  worktreePath: string,
  branch: string,
) =>
  Effect.gen(function* () {
    yield* updateStartup((progress) => {
      progress.step({
        id: "checkout",
        label: "Create task worktree",
        state: "pending",
        details: [worktreePath, branch],
      });
    });
    yield* dependencies.worktreeFiles.ensureDirectory(worktreeBase);

    let createdTrackingRef: string | null = null;
    let createdTaskWorktree = false;
    const actionRun = dependencies.worktreeActions.createRun({ worktreePath, branch });
    const rollback = (): Effect.Effect<void, TaskStartRollbackError> =>
      startupStep(
        {
          id: "cleanup",
          label: "Clean up new worktree",
          resources: [
            { kind: "worktree", value: worktreePath, state: "retained" },
            { kind: "branch", value: branch, state: "retained" },
          ],
        },
        Effect.gen(function* () {
          if (!createdTaskWorktree) return;
          yield* updateStartup((progress) => progress.phase("settling"));
          yield* actionRun.stopTerminals();
          yield* rollbackFailedTaskWorktree(
            dependencies,
            canonicalRepoPath,
            worktreePath,
            branch,
            createdTrackingRef,
            worktreeBase,
          );
          yield* updateStartup((progress) =>
            progress.step({
              id: "cleanup",
              label: "Clean up new worktree",
              state: "completed",
              resources: [
                { kind: "worktree", value: worktreePath, state: "removed" },
                { kind: "branch", value: branch, state: "removed" },
              ],
            }),
          );
        }),
      );
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
        yield* updateStartup((progress) => {
          if (startPoint.upstreamRemote)
            progress.step({
              id: "upstream",
              label: "Set branch upstream",
              state: "pending",
              details: [startPoint.upstreamRemote],
            });
          progress.step({
            id: "copies",
            label: "Copy configured files",
            state: "pending",
            details: repoConfig.worktreeCopyPaths,
          });
          for (const action of repoConfig.actions.items.filter((item) => item.runOnWorktreeCreate))
            progress.step({ ...worktreeActionStep(action), state: "pending" });
        });
        yield* startupStep(
          { id: "checkout", label: "Create task worktree", details: [worktreePath, branch] },
          dependencies.gitPort.createWorktree(
            canonicalRepoPath,
            worktreePath,
            branch,
            true,
            startPoint.reference,
          ),
        );
        createdTaskWorktree = true;
        yield* updateStartup((progress) =>
          progress.step({
            id: "checkout",
            label: "Create task worktree",
            state: "completed",
            resources: [
              { kind: "worktree", value: worktreePath, state: "created" },
              { kind: "branch", value: branch, state: "created" },
            ],
          }),
        );

        if (startPoint.upstreamRemote) {
          const upstreamSetup = yield* startupStep(
            { id: "upstream", label: "Set branch upstream", details: [startPoint.upstreamRemote] },
            dependencies.gitPort.configureBranchUpstream(
              canonicalRepoPath,
              worktreePath,
              branch,
              startPoint.upstreamRemote,
            ),
          );
          createdTrackingRef = upstreamSetup.createdTrackingRef;
        }

        yield* startupStep(
          { id: "copies", label: "Copy configured files", details: repoConfig.worktreeCopyPaths },
          dependencies.worktreeFiles.copyConfiguredPaths(
            canonicalRepoPath,
            worktreePath,
            repoConfig.worktreeCopyPaths,
          ),
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
