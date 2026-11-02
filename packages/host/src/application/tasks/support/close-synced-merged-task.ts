import { Effect } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { TaskActivityGuardPort } from "../../../ports/task-activity-guard-port";
import type { TaskStorePort } from "../../../ports/task-repository-ports";
import type { TaskWorkflowResolver } from "../../../ports/task-workflow-port";
import type { TaskWorktreeOwnerReader } from "../../../ports/task-worktree-owner-port";
import type { TaskServiceError } from "../task-service";
import type { TaskSessionLifecycleCoordinator } from "../worktrees/task-session-lifecycle-coordinator";
import type { requireMergedTaskCleanupDependencies } from "./required-task-dependencies";
import { completeTaskClosure } from "./task-closure";
import { requireEffect } from "./task-workflow-events";
import { cleanupMergedTaskState } from "./task-worktree-cleanup";

/**
 * Closes a task whose linked pull request merged, when its workflow allows the close. No user
 * confirms this close, so its cleanup follows the task value, else the global setting.
 */
export const closeSyncedMergedTask = (
  services: ReturnType<typeof requireMergedTaskCleanupDependencies> & {
    taskStore: TaskStorePort;
    taskWorkflows: TaskWorkflowResolver;
    taskActivityGuard: TaskActivityGuardPort | undefined;
    taskSessionLifecycleCoordinator: TaskSessionLifecycleCoordinator;
    worktreeOwners: TaskWorktreeOwnerReader | undefined;
  },
  input: {
    workspaceId: string;
    repoPath: string;
    taskId: string;
    sourceBranch: string;
    targetBranch: string;
  },
) =>
  Effect.gen(function* () {
    const { taskStore, taskWorkflows, taskSessionLifecycleCoordinator } = services;
    const { workspaceId, repoPath, taskId } = input;
    const current = yield* taskStore.getTask({ workspaceId, repoPath, taskId });
    const workflow = taskWorkflows.forTask(current);
    const decision = yield* requireEffect(workflow, "pull_request.merged", current);
    if (decision.kind === "unchanged") return;
    yield* completeTaskClosure({
      workspaceId,
      cleanup: cleanupMergedTaskState(
        { ...services, workflow },
        taskStore,
        repoPath,
        taskId,
        input.sourceBranch,
        input.targetBranch,
        current.removeWorktreeOnClose,
        workspaceId,
      ),
      gitPort: services.gitPort,
      operation: "sync merged pull request",
      repoPath,
      taskWorkflows,
      effect: "pull_request.merged",
      taskId,
      taskSessionLifecycleCoordinator,
      taskStore,
    });
  });

/**
 * The failure of a sync that could not close one or more merged tasks. A sync tries every task, so
 * one blocked task cannot stop the updates of the others.
 */
export const syncedMergedTaskFailure = (
  failures: ReadonlyArray<{ taskId: string; failure: TaskServiceError }>,
): TaskServiceError | null => {
  const [first, ...others] = failures;
  if (!first) return null;
  if (others.length === 0) return first.failure;
  return new HostOperationError({
    operation: "repo_pull_request_sync",
    message: `Cannot close ${failures.length} merged tasks. ${failures.map(({ taskId, failure }) => `Task ${taskId}: ${failure.message}`).join(" ")}`,
    cause: failures.map(({ failure }) => failure),
    details: { taskIds: failures.map(({ taskId }) => taskId) },
  });
};
