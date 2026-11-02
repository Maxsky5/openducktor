import { getScopedRepoConfig } from "./scoped-repo-config";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { TaskWorkflow } from "@openducktor/workflows";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../../domain/path-comparison";
import { HostValidationError } from "../../../effect/host-errors";
import type { TaskActivityGuardPort } from "../../../ports/task-activity-guard-port";
import type { TaskRecord, TaskStorePort } from "../../../ports/task-repository-ports";
import type { TaskSessionLifecycleCoordinator } from "../worktrees/task-session-lifecycle-coordinator";
import type { TaskWorktreeService } from "../worktrees/task-worktree-service";
import type { requireMergedTaskCleanupDependencies } from "./required-task-dependencies";
import type { requireTaskCloseDependencies } from "./task-cleanup-dependencies";
import { createTaskCleanupProgressState } from "./task-cleanup-progress";
import {
  collectRelatedTaskBranches,
  managedWorktreeBaseForRepoConfig,
  runTaskLocalCleanup,
  validateExistingTaskWorktreeCandidate,
} from "./task-cleanup-support";
import type { TaskWorktreeOwnerReader } from "../../../ports/task-worktree-owner-port";
import { acquireRemovableWorktrees } from "./task-worktree-owner-guard";
import { cleanupKeptTaskWorktree, releaseMergedTaskSessions } from "./task-worktree-cleanup";

/** What a confirmed merge close does with the task worktree and its local branches. */
export type WorktreeCleanup = {
  remove: boolean;
  /** Remove the worktree even when it has uncommitted changes. The user must confirm them. */
  force: boolean;
};

type CloseWorktreeCandidate = {
  path: string;
  source: "task_worktree" | "session";
};

const collectCloseManagedSessionWorktreePaths = (
  workflow: TaskWorkflow,
  sessions: AgentSessionRecord[],
): CloseWorktreeCandidate[] =>
  sessions.reduce<CloseWorktreeCandidate[]>((candidates, session) => {
    if (!workflow.hasRole(session.role.trim())) {
      return candidates;
    }

    const workingDirectory = session.workingDirectory.trim();
    if (workingDirectory.length > 0) {
      candidates.push({ path: workingDirectory, source: "session" });
    }

    return candidates;
  }, []);

export const collectCloseWorktreePaths = (
  dependencies: ReturnType<typeof requireTaskCloseDependencies> & {
    taskWorktreeService?: TaskWorktreeService;
  },
  repoPath: string,
  workflow: TaskWorkflow,
  task: TaskRecord,
  sessions: AgentSessionRecord[],
  workspaceId: string,
) =>
  Effect.gen(function* () {
    const normalizedRepo = normalizePathForComparison(repoPath);
    const taskWorktree = dependencies.taskWorktreeService
      ? yield* dependencies.taskWorktreeService.getTaskWorktree({
          workspaceId,
          repoPath,
          taskId: task.id,
        })
      : null;
    const candidatePaths: CloseWorktreeCandidate[] = [
      ...(taskWorktree
        ? [{ path: taskWorktree.workingDirectory, source: "task_worktree" as const }]
        : []),
      ...collectCloseManagedSessionWorktreePaths(workflow, sessions),
    ];
    const seen = new Set<string>();
    const paths: string[] = [];

    for (const candidate of candidatePaths) {
      const worktreePath = candidate.path;
      const normalizedWorktree = normalizePathForComparison(worktreePath);
      if (normalizedWorktree === normalizedRepo) {
        if (candidate.source === "session") {
          continue;
        }

        return yield* Effect.fail(
          new HostValidationError({
            field: "taskId",
            message: `Cannot close task ${task.id} because worktree ${worktreePath} resolves to the repository root.`,
            details: { repoPath, taskId: task.id, worktreePath },
          }),
        );
      }
      if (seen.has(normalizedWorktree)) {
        continue;
      }
      seen.add(normalizedWorktree);
      if (yield* dependencies.settingsConfig.pathExists(worktreePath)) {
        const validated = yield* validateExistingTaskWorktreeCandidate(
          dependencies.gitPort,
          repoPath,
          worktreePath,
          task.id,
          "close",
        );
        const normalizedValidated = normalizePathForComparison(validated);
        if (seen.has(normalizedValidated) && normalizedValidated !== normalizedWorktree) {
          continue;
        }
        seen.add(normalizedValidated);
        paths.push(validated);
        continue;
      }
      // Missing candidates stay in the list so shared local cleanup can apply
      // its explicit missing-path policy while preserving dependency checks.
      paths.push(worktreePath);
    }

    return paths;
  });

/**
 * Collects the worktrees and local branches that the cleanup of one task removes. It holds the
 * lifecycle of those worktrees for the rest of the scope.
 */
export const collectTaskCleanupTargets = ({
  dependencies,
  lifecycle,
  worktreeOwners,
  repoPath,
  workspaceId,
  branchPrefix,
  workflow,
  task,
  sessions,
  operationLabel,
}: {
  dependencies: Parameters<typeof collectCloseWorktreePaths>[0];
  lifecycle: Pick<TaskSessionLifecycleCoordinator, "acquireWorktreeLifecycle">;
  worktreeOwners: TaskWorktreeOwnerReader | undefined;
  repoPath: string;
  workspaceId: string;
  branchPrefix: string;
  workflow: TaskWorkflow;
  task: TaskRecord;
  sessions: AgentSessionRecord[];
  operationLabel: string;
}) =>
  Effect.gen(function* () {
    const worktreePaths = yield* collectCloseWorktreePaths(
      dependencies,
      repoPath,
      workflow,
      task,
      sessions,
      workspaceId,
    );
    // Each caller runs after a confirmation that shows these owners.
    const checkedWorktreePaths = yield* acquireRemovableWorktrees(
      { lifecycle, worktreeOwners },
      {
        workspaceId,
        repoPath,
        taskId: task.id,
        operationLabel,
        lockedPaths: worktreePaths,
        confirmed: true,
      },
    );
    const branchNames = yield* collectRelatedTaskBranches(
      dependencies.gitPort,
      repoPath,
      branchPrefix,
      [task.id],
      worktreePaths,
      operationLabel,
    );
    return { worktreePaths: checkedWorktreePaths, branchNames };
  });

/**
 * The cleanup of a merge close that the user confirmed. The confirmation shows the cleanup impact,
 * so this cleanup removes the same targets as a manual close: the task worktree, the saved session
 * worktrees, and every related local branch.
 */
export const cleanupConfirmedMergeClose = ({
  dependencies,
  taskStore,
  lifecycle,
  repoPath,
  workspaceId,
  workflow,
  task,
  worktreeCleanup,
  onBranchDeleting,
}: {
  dependencies: ReturnType<typeof requireMergedTaskCleanupDependencies> & {
    taskActivityGuard?: TaskActivityGuardPort | undefined;
    worktreeOwners: TaskWorktreeOwnerReader | undefined;
  };
  taskStore: Pick<TaskStorePort, "getTaskMetadata">;
  lifecycle: Pick<TaskSessionLifecycleCoordinator, "acquireWorktreeLifecycle">;
  repoPath: string;
  workspaceId: string;
  workflow: TaskWorkflow;
  task: TaskRecord;
  worktreeCleanup: WorktreeCleanup;
  onBranchDeleting?: ((branch: { name: string; oid: string }) => void) | undefined;
}) =>
  Effect.gen(function* () {
    const releaseDependencies = { ...dependencies, workflow };
    if (!worktreeCleanup.remove) {
      return yield* cleanupKeptTaskWorktree(
        releaseDependencies,
        taskStore,
        repoPath,
        task.id,
        workspaceId,
      );
    }
    const progress = createTaskCleanupProgressState();
    const repoConfig = yield* getScopedRepoConfig(dependencies.workspaceSettingsService, {
      workspaceId,
      repoPath,
    });
    const metadata = yield* taskStore.getTaskMetadata({ workspaceId, repoPath, taskId: task.id });
    const { worktreePaths, branchNames } = yield* collectTaskCleanupTargets({
      dependencies,
      lifecycle,
      workspaceId,
      worktreeOwners: dependencies.worktreeOwners,
      repoPath,
      branchPrefix: repoConfig.branchPrefix,
      workflow,
      task,
      sessions: metadata.agentSessions,
      operationLabel: "close",
    });
    // The worktree lifecycle is held, so no runtime read restores a released session.
    yield* releaseMergedTaskSessions(
      releaseDependencies,
      taskStore,
      repoPath,
      task.id,
      workspaceId,
    );
    yield* runTaskLocalCleanup({
      workspaceId,
      branchNames,
      gitPort: dependencies.gitPort,
      managedWorktreeBasePath: managedWorktreeBaseForRepoConfig(
        dependencies.settingsConfig,
        repoConfig,
      ),
      progress,
      repoPath,
      settingsConfig: dependencies.settingsConfig,
      taskIds: [task.id],
      terminalService: dependencies.terminalService,
      worktreeCleanupOperation: "task_close",
      worktreeFiles: dependencies.worktreeFiles,
      worktreePaths,
      forceWorktreeRemoval: worktreeCleanup.force,
      onBranchDeleting,
    });
  });
