import {
  type AgentSessionRecord,
  type RepoConfig,
  type TaskStopImpact,
  type TaskStopImpactOperation,
  type TaskStopImpactRequest,
} from "@openducktor/contracts";
import type { TaskWorkflow } from "@openducktor/workflows";
import { Effect } from "effect";
import { HostDependencyError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { TaskActivityGuardPort } from "../../../ports/task-activity-guard-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import { collectImplementationResetSessionState } from "../support/implementation-reset-targets";
import { requireDependencies } from "../support/required-task-dependencies";
import { selectWorkflowCleanupSessionRecords } from "../support/task-cleanup-support";
import { countRemovedWorktrees } from "../support/task-removed-worktrees";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

type TaskStopImpactDependencies = {
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  workspaceSettingsService: WorkspaceSettingsService;
};

type StopImpactTarget = {
  taskId: string;
  sessions: AgentSessionRecord[];
};

const requireTaskStopImpactDependencies = (
  gitPort: GitPort | undefined,
  settingsConfig: SettingsConfigPort | undefined,
  workspaceSettingsService: WorkspaceSettingsService | undefined,
): TaskStopImpactDependencies => {
  if (!gitPort) {
    throw new HostDependencyError({
      dependency: "gitPort",
      operation: "task_stop_impact_get",
      message: "Git port is required for task stop impact previews.",
    });
  }
  if (!settingsConfig) {
    throw new HostDependencyError({
      dependency: "settingsConfig",
      operation: "task_stop_impact_get",
      message: "Settings config port is required for task stop impact previews.",
    });
  }
  if (!workspaceSettingsService) {
    throw new HostDependencyError({
      dependency: "workspaceSettingsService",
      operation: "task_stop_impact_get",
      message: "Workspace settings service is required for task stop impact previews.",
    });
  }
  return { gitPort, settingsConfig, workspaceSettingsService };
};

// Keep this filter in step with each stop path.
const selectStopCandidates = (
  workflow: TaskWorkflow,
  operation: TaskStopImpactOperation,
  sessions: AgentSessionRecord[],
): AgentSessionRecord[] => {
  if (operation === "reset_task" || operation === "close" || operation === "delete") {
    return selectWorkflowCleanupSessionRecords(workflow, sessions);
  }
  return sessions;
};

const countStoppableSessions = (
  dependencies: TaskStopImpactDependencies,
  taskActivityGuard: TaskActivityGuardPort | undefined,
  workflow: TaskWorkflow,
  input: TaskStopImpactRequest,
  repoConfig: RepoConfig,
  effectiveRepoPath: string,
  targets: StopImpactTarget[],
) =>
  Effect.gen(function* () {
    const tasksWithSessions = targets.filter((target) => target.sessions.length > 0);
    const previewTasks: StopImpactTarget[] = [];
    for (const { taskId, sessions } of tasksWithSessions) {
      let candidates = selectStopCandidates(workflow, input.operation, sessions);
      if (input.operation === "reset_implementation") {
        const { sessionState } = yield* collectImplementationResetSessionState(
          dependencies,
          workflow,
          repoConfig,
          taskId,
          sessions,
        );
        candidates = sessionState.guarded;
      }
      if (candidates.length === 0) {
        continue;
      }
      previewTasks.push({ taskId, sessions: candidates });
    }
    // Like the stop paths, do not require a guard when no sessions match.
    if (previewTasks.length === 0) {
      return 0;
    }
    if (!taskActivityGuard) {
      return yield* Effect.fail(
        new HostDependencyError({
          dependency: "taskActivityGuard",
          operation: "task_stop_impact_get",
          message:
            "task_stop_impact_get requires runtime session activity checks for tasks with agent sessions.",
          details: { repoPath: input.repoPath, taskId: tasksWithSessions[0]?.taskId },
        }),
      );
    }
    const { liveSessionCount } = yield* taskActivityGuard.countLiveSessions({
      repoPath: effectiveRepoPath,
      taskSessions: previewTasks,
    });
    return liveSessionCount;
  });

export const createTaskStopImpactUseCase = ({
  gitPort,
  taskStore,
  taskWorkflows,
  taskActivityGuard,
  settingsConfig,
  taskWorktreeService,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<TaskService, "getTaskStopImpact"> => ({
  getTaskStopImpact(input: TaskStopImpactRequest) {
    return Effect.gen(function* () {
      const dependencies = yield* requireDependencies(() =>
        requireTaskStopImpactDependencies(gitPort, settingsConfig, workspaceSettingsService),
      );
      const repoConfig = yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(
        input.repoPath,
      );
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const workflow = taskWorkflows.forRepo(input.repoPath);
      const taskIds = [...new Set(input.taskIds)];
      const currentTasks = yield* taskStore.listTasks({ repoPath: input.repoPath });
      const targets: StopImpactTarget[] = [];
      for (const taskId of taskIds) {
        const metadata = yield* taskStore.getTaskMetadata({ repoPath: input.repoPath, taskId });
        targets.push({ taskId, sessions: metadata.agentSessions });
      }
      const stoppableSessionCount = yield* countStoppableSessions(
        dependencies,
        taskActivityGuard,
        workflow,
        input,
        repoConfig,
        effectiveRepoPath,
        targets,
      );
      if (input.operation === "reset_implementation") {
        return { stoppableSessionCount } satisfies TaskStopImpact;
      }
      const removedWorktreeCount = yield* countRemovedWorktrees(
        { ...dependencies, taskWorktreeService },
        input.operation,
        workflow,
        repoConfig,
        effectiveRepoPath,
        targets.flatMap((target) => {
          const task = currentTasks.find((entry) => entry.id === target.taskId);
          return task ? [{ ...target, task }] : [];
        }),
      );
      return { stoppableSessionCount, removedWorktreeCount } satisfies TaskStopImpact;
    });
  },
});
