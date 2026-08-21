import { type TaskStopImpactOperation } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostDependencyError } from "../../../effect/host-errors";
import type { GitPort } from "../../../ports/git-port";
import type { SettingsConfigPort } from "../../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "../../workspaces/workspace-settings-service";
import { requireDependencies } from "../support/required-task-dependencies";
import {
  collectSessionsUsingCanonicalWorktree,
  managedWorktreeBaseForRepoConfig,
  workflowCleanupSessionRoleNames,
} from "../support/task-cleanup-support";
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

const requireTaskStopImpactDependencies = ({
  gitPort,
  settingsConfig,
  workspaceSettingsService,
}: {
  gitPort?: GitPort;
  settingsConfig?: SettingsConfigPort;
  workspaceSettingsService?: WorkspaceSettingsService;
}): TaskStopImpactDependencies => {
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
// previewed count matches what stopActiveTask* will actually stop.
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
        requireTaskStopImpactDependencies({
          ...(gitPort ? { gitPort } : {}),
          ...(settingsConfig ? { settingsConfig } : {}),
          ...(workspaceSettingsService ? { workspaceSettingsService } : {}),
        }),
      );
      const repoConfig = yield* dependencies.workspaceSettingsService.getRepoConfigByRepoPath(
        input.repoPath,
      );
      const effectiveRepoPath = yield* dependencies.gitPort.canonicalizePath(repoConfig.repoPath);
      const managedWorktreeBasePath = managedWorktreeBaseForRepoConfig(
        dependencies.settingsConfig,
        repoConfig,
      );
      const taskIds = [...new Set(input.taskIds)];
      let stoppableSessionCount = 0;
      for (const taskId of taskIds) {
        const metadata = yield* taskStore.getTaskMetadata({
          repoPath: input.repoPath,
          taskId,
        });
        const sessions = metadata.agentSessions;
        if (sessions.length === 0) {
          continue;
        }
        if (!taskActivityGuard) {
          return yield* Effect.fail(
            new HostDependencyError({
              dependency: "taskActivityGuard",
              operation: "task_stop_impact_get",
              message:
                "task_stop_impact_get requires runtime session activity checks for tasks with agent sessions.",
              details: { repoPath: input.repoPath, taskId },
            }),
          );
        }
        const candidates =
          input.operation === "reset_implementation"
            ? (yield* collectSessionsUsingCanonicalWorktree(
                dependencies.gitPort,
                dependencies.settingsConfig,
                sessions,
                dependencies.settingsConfig.join(managedWorktreeBasePath, taskId),
              )).guarded
            : sessions;
        if (candidates.length === 0) {
          continue;
        }
        const sessionRoles =
          input.operation === "reset_implementation"
            ? candidates.map((session) => session.role.trim())
            : input.operation === "delete"
              ? candidates.map((session) => session.role)
              : [...workflowCleanupSessionRoleNames];
        const { liveSessionCount } = yield* taskActivityGuard.countLiveSessions({
          repoPath: effectiveRepoPath,
          sessions: candidates,
          sessionRoles,
        });
        stoppableSessionCount += liveSessionCount;
      }
      return { stoppableSessionCount };
    });
  },
});
