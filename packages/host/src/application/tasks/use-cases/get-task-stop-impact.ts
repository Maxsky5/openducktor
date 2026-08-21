import { type AgentSessionRecord, type TaskStopImpactOperation } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostDependencyError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import { collectImplementationResetSessionState } from "../support/implementation-reset-targets";
import { requireDependencies } from "../support/required-task-dependencies";
import { workflowCleanupSessionRoles } from "../support/task-cleanup-support";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export type TaskStopImpactInput = {
  repoPath: string;
  taskIds: string[];
  operation: TaskStopImpactOperation;
};

type TaskStopImpactDependencies = {
  gitPort: GitPort;
  settingsConfig: SettingsConfigPort;
  workspaceSettingsService: WorkspaceSettingsService;
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

// Candidate selection must mirror the matching mutation's guard inputs so the
// preview probes exactly the sessions stopLiveSessions would stop.
const selectStopCandidates = (
  operation: TaskStopImpactOperation,
  sessions: AgentSessionRecord[],
): AgentSessionRecord[] => {
  if (operation === "reset_task" || operation === "close") {
    return sessions.filter((session) => workflowCleanupSessionRoles.has(session.role.trim()));
  }
  return sessions;
};

export const createTaskStopImpactUseCase = ({
  gitPort,
  taskStore,
  taskActivityGuard,
  settingsConfig,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<TaskService, "getTaskStopImpact"> => ({
  getTaskStopImpact(input: TaskStopImpactInput) {
    return Effect.gen(function* () {
      const dependencies = yield* requireDependencies(() =>
        requireTaskStopImpactDependencies(gitPort, settingsConfig, workspaceSettingsService),
      );
      const repoConfig = yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(
        input.repoPath,
      );
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const taskIds = [...new Set(input.taskIds)];
      const tasksWithSessions: Array<{ taskId: string; sessions: AgentSessionRecord[] }> = [];
      for (const taskId of taskIds) {
        const metadata = yield* taskStore.getTaskMetadata({
          repoPath: input.repoPath,
          taskId,
        });
        if (metadata.agentSessions.length === 0) {
          continue;
        }
        tasksWithSessions.push({ taskId, sessions: metadata.agentSessions });
      }
      if (tasksWithSessions.length === 0) {
        return { stoppableSessionCount: 0 };
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

      const previewTasks: Array<{ taskId: string; sessions: AgentSessionRecord[] }> = [];
      for (const { taskId, sessions } of tasksWithSessions) {
        let candidates = selectStopCandidates(input.operation, sessions);
        if (input.operation === "reset_implementation") {
          const { sessionState } = yield* collectImplementationResetSessionState(
            dependencies,
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
      if (previewTasks.length === 0) {
        return { stoppableSessionCount: 0 };
      }
      const { liveSessionCount } = yield* taskActivityGuard.countLiveSessions({
        repoPath: effectiveRepoPath,
        taskSessions: previewTasks,
      });
      return { stoppableSessionCount: liveSessionCount };
    });
  },
});
