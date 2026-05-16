import type { AgentSessionRecord } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../../effect/host-errors";
import { requireAgentSessionDependencies } from "../support/required-task-dependencies";
import {
  enrichTasks,
  validateAgentSessionWorkingDirectory,
} from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskQueryUseCases = ({
  taskStore,
  settingsConfig,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<
  TaskService,
  | "listTasks"
  | "getTaskMetadata"
  | "agentSessionsList"
  | "agentSessionsListBulk"
  | "agentSessionUpsert"
> => ({
  listTasks(input) {
    return Effect.gen(function* () {
      const tasks = yield* taskStore.listTasks(input);

      return enrichTasks(tasks);
    });
  },

  getTaskMetadata(input) {
    return taskStore.getTaskMetadata(input);
  },

  agentSessionsList(input) {
    return Effect.gen(function* () {
      const metadata = yield* taskStore.getTaskMetadata(input);

      return metadata.agentSessions;
    });
  },

  agentSessionsListBulk(input) {
    return Effect.gen(function* () {
      const { repoPath, taskIds } = input;
      if (taskIds.length === 0) {
        return {};
      }

      const currentTasks = yield* taskStore.listTasks({ repoPath });
      const sessionsByAvailableTask = new Map(
        currentTasks.map((task) => [task.id, task.agentSessions ?? []]),
      );
      const sessionsByTask: Record<string, AgentSessionRecord[]> = {};
      for (const taskId of taskIds) {
        const sessions = sessionsByAvailableTask.get(taskId);
        if (sessions === undefined) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskIds",
              message: `Task not found: ${taskId}`,
              details: { repoPath, taskId },
            }),
          );
        }
        sessionsByTask[taskId] = sessions;
      }

      return sessionsByTask;
    });
  },

  agentSessionUpsert(input) {
    return Effect.gen(function* () {
      const { repoPath, taskId, session } = input;
      const dependencies = requireAgentSessionDependencies(
        taskStore,
        settingsConfig,
        workspaceSettingsService,
      );

      yield* validateAgentSessionWorkingDirectory(
        dependencies.settingsConfig,
        dependencies.workspaceSettingsService,
        repoPath,
        session,
      );
      yield* dependencies.upsertAgentSession({ repoPath, taskId, session });

      return true;
    });
  },
});
