import type { TaskCard, WorkspaceScopedOdtToolName } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type HostOperationErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { TaskAssetReadService } from "../task-assets/task-asset-read-service";
import type { TaskService, TaskServiceError } from "../tasks/task-service";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";
import { resolveTaskReference } from "./odt-mcp-bridge-model";

export type OdtMcpBridgeError =
  | HostOperationErrorAggregate
  | HostValidationErrorAggregate
  | TaskServiceError
  | WorkspaceSettingsError;

export type OdtMcpReadToolName =
  | "odt_read_task"
  | "odt_read_task_assets"
  | "odt_read_task_documents"
  | "odt_search_tasks";

export type OdtMcpMutationToolName = Exclude<WorkspaceScopedOdtToolName, OdtMcpReadToolName>;

type OdtMcpTaskAssetReadService = Pick<TaskAssetReadService, "readBatch">;
type OdtMcpTaskService = Pick<
  TaskService,
  | "buildBlocked"
  | "buildCompleted"
  | "buildResumed"
  | "createTask"
  | "getTaskMetadata"
  | "linkPullRequest"
  | "listTasks"
  | "qaApproved"
  | "qaRejected"
  | "setPlan"
  | "setSpec"
  | "updateTask"
>;
type OdtMcpWorkspaceSettingsService = Pick<
  WorkspaceSettingsService,
  "getRepoConfig" | "listWorkspaces"
>;

export type CreateOdtMcpToolContextInput = {
  taskAssetReadService: OdtMcpTaskAssetReadService;
  taskService: OdtMcpTaskService;
  workspaceSettingsService: OdtMcpWorkspaceSettingsService;
};

export const createOdtMcpToolContext = ({
  taskAssetReadService,
  taskService,
  workspaceSettingsService,
}: CreateOdtMcpToolContextInput) => {
  const repoPathForWorkspace = (workspaceId: string) =>
    Effect.gen(function* () {
      const repoConfig = yield* workspaceSettingsService.getRepoConfig(workspaceId);
      return repoConfig.repoPath;
    });
  const tasksForWorkspace = (workspaceId: string) =>
    Effect.gen(function* () {
      const repoPath = yield* repoPathForWorkspace(workspaceId);
      return yield* taskService.listTasks({ repoPath });
    });
  const resolveTask = (tasks: TaskCard[], taskId: string) =>
    Effect.try({
      try: () => resolveTaskReference(tasks, taskId),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
          details: {
            operation: "odt_mcp_bridge.resolve_task_reference",
          },
        }),
    });
  const taskForWorkspace = (workspaceId: string, taskId: string) =>
    Effect.gen(function* () {
      const tasks = yield* tasksForWorkspace(workspaceId);
      return yield* resolveTask(tasks, taskId);
    });

  return {
    taskAssetReadService,
    taskService,
    workspaceSettingsService,
    repoPathForWorkspace,
    tasksForWorkspace,
    taskForWorkspace,
    resolveTask,
  };
};

export type OdtMcpToolContext = ReturnType<typeof createOdtMcpToolContext>;
