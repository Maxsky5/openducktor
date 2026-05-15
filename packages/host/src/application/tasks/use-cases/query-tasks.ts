import type { AgentSessionRecord } from "@openducktor/contracts";
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
  async listTasks(input) {
    const tasks = await taskStore.listTasks(input);

    return enrichTasks(tasks);
  },

  async getTaskMetadata(input) {
    return taskStore.getTaskMetadata(input);
  },

  async agentSessionsList(input) {
    const metadata = await taskStore.getTaskMetadata(input);

    return metadata.agentSessions;
  },

  async agentSessionsListBulk(input) {
    const { repoPath, taskIds } = input;
    if (taskIds.length === 0) {
      return {};
    }

    const currentTasks = await taskStore.listTasks({ repoPath });
    const sessionsByAvailableTask = new Map(
      currentTasks.map((task) => [task.id, task.agentSessions ?? []]),
    );
    const sessionsByTask: Record<string, AgentSessionRecord[]> = {};
    for (const taskId of taskIds) {
      const sessions = sessionsByAvailableTask.get(taskId);
      if (sessions === undefined) {
        throw new Error(`Task not found: ${taskId}`);
      }
      sessionsByTask[taskId] = sessions;
    }

    return sessionsByTask;
  },

  async agentSessionUpsert(input) {
    const { repoPath, taskId, session } = input;
    const dependencies = requireAgentSessionDependencies(
      taskStore,
      settingsConfig,
      workspaceSettingsService,
    );

    await validateAgentSessionWorkingDirectory(
      dependencies.settingsConfig,
      dependencies.workspaceSettingsService,
      repoPath,
      session,
    );
    await dependencies.upsertAgentSession({ repoPath, taskId, session });

    return true;
  },
});
