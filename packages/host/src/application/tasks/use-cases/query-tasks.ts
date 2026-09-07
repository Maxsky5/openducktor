import { Effect } from "effect";
import { HostDependencyError, HostInvariantError } from "../../../effect/host-errors";
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
  | "listKanbanTasks"
  | "getTaskMetadata"
  | "agentSessionsList"
  | "agentSessionDelete"
  | "agentSessionUpdateModel"
  | "agentSessionsListForTasks"
  | "agentSessionUpsert"
> => ({
  listTasks(input) {
    return Effect.gen(function* () {
      const tasks = yield* taskStore.listTasks(input);

      return enrichTasks(tasks);
    });
  },

  listKanbanTasks(input) {
    return Effect.gen(function* () {
      if (!workspaceSettingsService) {
        return yield* Effect.fail(
          new HostDependencyError({
            dependency: "workspaceSettingsService",
            operation: "tasks_list",
            message: "Workspace settings service is required for tasks_list.",
          }),
        );
      }
      const settings = yield* workspaceSettingsService.getSettingsSnapshot();
      const tasks = yield* taskStore.listTasks({
        ...input,
        doneVisibleDays: settings.kanban.doneVisibleDays,
      });

      return enrichTasks(tasks);
    });
  },

  getTaskMetadata(input) {
    return taskStore.getTaskMetadata(input);
  },

  agentSessionsList(input) {
    return Effect.gen(function* () {
      const [task] = yield* taskStore.listAgentSessionsForTasks({
        repoPath: input.repoPath,
        taskIds: [input.taskId],
      });
      if (!task) {
        return yield* new HostInvariantError({
          invariant: "task-agent-sessions-result",
          message: `Task store returned no session result for task: ${input.taskId}`,
          details: input,
        });
      }
      return task.agentSessions;
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

  agentSessionUpdateModel(input) {
    return taskStore.updateAgentSessionModel(input);
  },

  agentSessionDelete({ repoPath, taskId, identity }) {
    return taskStore.deleteAgentSession({ repoPath, taskId, identity });
  },
});
