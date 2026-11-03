import type { WorkspaceRef } from "@openducktor/contracts";
import { HostValidationError } from "../../../effect/host-errors";
import { loadTaskSessions } from "../support/task-sessions";
import { getScopedRepoConfig } from "../support/scoped-repo-config";
import { Effect } from "effect";
import { HostDependencyError } from "../../../effect/host-errors";
import { requireAgentSessionDependencies } from "../support/required-task-dependencies";
import {
  enrichTask,
  enrichTasks,
  validateAgentSessionWorkingDirectory,
} from "../support/task-workflow-helpers";
import type { CreateTaskServiceInput, TaskService } from "../task-service";
import { resolveRuntimeOwnershipScope } from "../../workspaces/workspace-session-import-owners";

export const createTaskQueryUseCases = ({
  taskStore,
  taskWorkflows,
  settingsConfig,
  workspaceSettingsService,
  gitPort,
}: CreateTaskServiceInput): Pick<
  TaskService,
  | "searchTasks"
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
> => {
  const boardFor = (scope: WorkspaceRef) =>
    Effect.try({
      try: () => taskWorkflows.forWorkspace(scope).board,
      catch: (cause) =>
        new HostValidationError({
          field: "board",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  return {
    findTask: (input) =>
      taskStore
        .findTask(input)
        .pipe(
          Effect.map((task) =>
            task === null ? null : enrichTask(taskWorkflows.forTask(task), task),
          ),
        ),
    listTaskReferences: (input) => taskStore.listTaskReferences(input),
    searchTasks: (input) =>
      taskStore
        .searchTasks(input)
        .pipe(
          Effect.map((result) => ({ ...result, tasks: enrichTasks(taskWorkflows, result.tasks) })),
        ),
    listTasks: (input) =>
      Effect.gen(function* () {
        yield* boardFor(input);
        const tasks = yield* taskStore.listTasks(input);
        return enrichTasks(taskWorkflows, tasks);
      }),

    listKanbanTasks(input) {
      return Effect.gen(function* () {
        if (!settingsConfig) {
          return yield* Effect.fail(
            new HostDependencyError({
              dependency: "settingsConfig",
              operation: "tasks_list",
              message: "Settings config port is required for tasks_list.",
            }),
          );
        }
        yield* boardFor(input);
        const settings = yield* settingsConfig.readGlobalConfig();
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
      return loadTaskSessions(taskStore, input);
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

        const workspace = yield* getScopedRepoConfig(dependencies.workspaceSettingsService, input);
        yield* validateAgentSessionWorkingDirectory(
          dependencies.settingsConfig,
          workspace,
          session,
        );
        if (!gitPort)
          return yield* new HostDependencyError({
            dependency: "gitPort",
            operation: "agent_session_upsert",
            message: "Git port is required to check session ownership before saving it.",
          });
        const ownershipScope = yield* resolveRuntimeOwnershipScope(
          {
            settings: dependencies.workspaceSettingsService,
            git: gitPort,
          },
          { workspaceId: workspace.workspaceId, repoPath },
        );
        yield* dependencies.upsertAgentSession({
          workspaceId: input.workspaceId,
          repoPath,
          taskId,
          session,
          ownershipScope,
        });

        return true;
      });
    },

    agentSessionUpdateModel(input) {
      return taskStore.updateAgentSessionModel(input);
    },

    agentSessionDelete(input) {
      return taskStore.deleteAgentSession(input);
    },
  };
};
