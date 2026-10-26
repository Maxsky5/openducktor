import { Effect } from "effect";
import { HostDependencyError, HostInvariantError } from "../../../effect/host-errors";
import { requireAgentSessionDependencies } from "../support/required-task-dependencies";
import {
  enrichTask,
  enrichTasks,
  validateAgentSessionWorkingDirectory,
} from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";

export const createTaskQueryUseCases = ({
  taskStore,
  taskWorkflows,
  settingsConfig,
  workspaceSettingsService,
}: CreateTaskServiceInput): Pick<
  TaskService,
  | "listTasks"
  | "findTask"
  | "listTaskReferences"
  | "listKanbanTasks"
  | "listTaskIds"
  | "getTaskMetadata"
  | "agentSessionsList"
  | "agentSessionDelete"
  | "agentSessionUpdateModel"
  | "agentSessionsListForTasks"
  | "agentSessionUpsert"
> => ({
  findTask: (input) =>
    taskStore
      .findTask(input)
      .pipe(
        Effect.map((task) =>
          task === null ? null : enrichTask(taskWorkflows.forTask(task), task),
        ),
      ),
  listTaskReferences: (input) => taskStore.listTaskReferences(input),
  listTasks: (input) =>
    taskStore.listTasks(input).pipe(Effect.map((tasks) => enrichTasks(taskWorkflows, tasks))),

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

      return enrichTasks(taskWorkflows, tasks);
    });
  },

  listTaskIds(input) {
    return taskStore.listTaskIds(input);
  },

  getTaskMetadata(input) {
    return taskStore.getTaskMetadata(input);
  },

  agentSessionsList(input) {
    return Effect.gen(function* () {
      const [taskSessions] = yield* taskStore.listAgentSessionsForTasks({
        repoPath: input.repoPath,
        taskIds: [input.taskId],
      });
      if (!taskSessions) {
        return yield* new HostInvariantError({
          invariant: "task-agent-sessions-result",
          message: `Task store returned no session result for task: ${input.taskId}`,
          details: input,
        });
      }
      return taskSessions.agentSessions;
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
