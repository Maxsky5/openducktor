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

      const availableTaskIds = new Set(
        (yield* taskStore.listTasks({ repoPath })).map((task) => task.id),
      );
      for (const taskId of taskIds) {
        if (!availableTaskIds.has(taskId)) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "taskIds",
              message: `Task not found: ${taskId}`,
              details: { repoPath, taskId },
            }),
          );
        }
      }

      const sessionsByTask: Record<string, AgentSessionRecord[]> = {};
      for (const taskId of taskIds) {
        const metadata = yield* taskStore.getTaskMetadata({ repoPath, taskId });
        sessionsByTask[taskId] = metadata.agentSessions;
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
