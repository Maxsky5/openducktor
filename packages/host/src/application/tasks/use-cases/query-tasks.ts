import { Effect } from "effect";
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
  | "agentSessionsListForTasks"
  | "agentSessionUpsert"
  | "agentSessionDelete"
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

  agentSessionsListForTasks(input) {
    return taskStore.listAgentSessionsForTasks(input);
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

  agentSessionDelete({ repoPath, taskId, identity }) {
    return taskStore.deleteAgentSession({ repoPath, taskId, identity });
  },
});
