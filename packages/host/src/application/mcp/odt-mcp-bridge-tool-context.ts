import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import type { OdtBrowserToolName, WorkspaceScopedOdtToolName } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type HostOperationErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { TaskReference } from "../../ports/task-repository-ports";
import type { BrowserCallerResolver } from "../browser/browser-caller-resolver";
import type { ManagedCallerResolver } from "../agent-sessions/managed-caller-resolver";
import type { BrowserService } from "../browser/browser-service-types";
import type { TaskAssetReadService } from "../task-assets/task-asset-read-service";
import type { TaskService, TaskServiceError } from "../tasks/task-service";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";
import { resolveTaskReference, taskNotFoundError } from "./odt-mcp-bridge-model";

export type OdtMcpBridgeError =
  | HostOperationErrorAggregate
  | HostValidationErrorAggregate
  | TaskServiceError
  | WorkspaceSettingsError;

export const ODT_MCP_READ_TOOL_NAMES = [
  "odt_read_task",
  "odt_read_task_assets",
  "odt_read_task_artifacts",
  "odt_search_tasks",
] as const satisfies readonly WorkspaceScopedOdtToolName[];

export type OdtMcpReadToolName = (typeof ODT_MCP_READ_TOOL_NAMES)[number];

/** Workspace tools that act on tasks. Browser tools also need the calling session. */
export type OdtMcpTaskToolName = Exclude<WorkspaceScopedOdtToolName, OdtBrowserToolName>;

export type OdtMcpMutationToolName = Exclude<OdtMcpTaskToolName, OdtMcpReadToolName>;

type OdtMcpTaskAssetReadService = Pick<TaskAssetReadService, "readBatch">;
type OdtMcpTaskService = Pick<
  TaskService,
  | "buildBlocked"
  | "buildCompleted"
  | "buildResumed"
  | "createTask"
  | "listTaskArtifacts"
  | "readTaskArtifact"
  | "createTaskArtifact"
  | "renameTaskArtifact"
  | "replaceTaskArtifact"
  | "deleteTaskArtifact"
  | "findTask"
  | "listTaskReferences"
  | "linkPullRequest"
  | "listTasks"
  | "updateTask"
  | "workflowArtifactSave"
>;
type OdtMcpWorkspaceSettingsService = Pick<
  WorkspaceSettingsService,
  "getRepoConfig" | "listWorkspaces"
>;

export type CreateOdtMcpToolContextInput = {
  taskWorkflows: TaskWorkflowResolver;
  browserAgentTools: Pick<BrowserService, "runAgentTool">;
  browserCallers: BrowserCallerResolver;
  managedCallers: ManagedCallerResolver;
  taskAssetReadService: OdtMcpTaskAssetReadService;
  taskService: OdtMcpTaskService;
  workspaceSettingsService: OdtMcpWorkspaceSettingsService;
};

export const createOdtMcpToolContext = ({
  taskWorkflows,
  browserAgentTools,
  browserCallers,
  managedCallers,
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
  const resolveTask = <Task extends TaskReference>(tasks: readonly Task[], taskId: string) =>
    Effect.try({
      try: () => resolveTaskReference(tasks, taskId),
      catch: taskReferenceError,
    });
  const taskScopeForWorkspace = (workspaceId: string, taskId: string) =>
    Effect.gen(function* () {
      const repoPath = yield* repoPathForWorkspace(workspaceId);
      const exactTask = yield* taskService.findTask({ repoPath, taskId: taskId.trim() });
      if (exactTask !== null) return { repoPath, task: exactTask };
      const candidates = yield* taskService.listTaskReferences({ repoPath });
      const reference = yield* resolveTask(candidates, taskId);
      const task = yield* taskService.findTask({ repoPath, taskId: reference.id });
      if (task !== null) return { repoPath, task };
      return yield* taskReferenceError(taskNotFoundError(taskId));
    });
  const taskForWorkspace = (workspaceId: string, taskId: string) =>
    taskScopeForWorkspace(workspaceId, taskId).pipe(Effect.map(({ task }) => task));

  return {
    taskWorkflows,
    browserAgentTools,
    browserCallers,
    managedCallers,
    taskAssetReadService,
    taskService,
    workspaceSettingsService,
    repoPathForWorkspace,
    tasksForWorkspace,
    taskForWorkspace,
    taskScopeForWorkspace,
    resolveTask,
  };
};

export type OdtMcpToolContext = ReturnType<typeof createOdtMcpToolContext>;

const taskReferenceError = (cause: unknown) =>
  new HostValidationError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
    details: {
      operation: "odt_mcp_bridge.resolve_task_reference",
    },
  });
