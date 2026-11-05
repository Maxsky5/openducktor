import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";
import {
  odtBrowserCallerSchema,
  type OdtBrowserToolName,
  type OdtToolName,
  type WorkspaceScopedOdtToolName,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { type JSONType, z } from "zod";
import {
  type HostOperationErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { TaskReference } from "../../ports/task-repository-ports";
import type { RuntimeSessionOwner } from "../../ports/workspace-session-store-port";
import type { BrowserCallerResolver } from "../browser/browser-caller-resolver";
import type { ManagedCallerResolver } from "../agent-sessions/managed-caller-resolver";
import type { BrowserService } from "../browser/browser-service-types";
import type { TaskAssetReadService } from "../task-assets/task-asset-read-service";
import type { TaskService, TaskServiceError } from "../tasks/task-service";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";
import { parseToolInput, resolveTaskReference, taskNotFoundError } from "./odt-mcp-bridge-model";

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
  | "applyAgentEvent"
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
  | "searchTasks"
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
  const workspaceScopeForWorkspace = (workspaceId: string) =>
    Effect.gen(function* () {
      const repoConfig = yield* workspaceSettingsService.getRepoConfig(workspaceId);
      return { workspaceId: repoConfig.workspaceId, repoPath: repoConfig.repoPath };
    });
  const repoPathForWorkspace = (workspaceId: string) =>
    workspaceScopeForWorkspace(workspaceId).pipe(Effect.map(({ repoPath }) => repoPath));
  const tasksForWorkspace = (workspaceId: string) =>
    Effect.gen(function* () {
      const scope = yield* workspaceScopeForWorkspace(workspaceId);
      return yield* taskService.listTasks(scope);
    });
  const resolveTask = <Task extends TaskReference>(tasks: readonly Task[], taskId: string) =>
    Effect.try({
      try: () => resolveTaskReference(tasks, taskId),
      catch: taskReferenceError,
    });
  const taskScopeForWorkspace = (workspaceId: string, taskId: string) =>
    Effect.gen(function* () {
      const scope = yield* workspaceScopeForWorkspace(workspaceId);
      const exactTask = yield* taskService.findTask({ ...scope, taskId: taskId.trim() });
      if (exactTask !== null) return { ...scope, task: exactTask };
      const candidates = yield* taskService.listTaskReferences(scope);
      const reference = yield* resolveTask(candidates, taskId);
      const task = yield* taskService.findTask({ ...scope, taskId: reference.id });
      if (task !== null) return { ...scope, task };
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
    workspaceScopeForWorkspace,
    repoPathForWorkspace,
    tasksForWorkspace,
    taskForWorkspace,
    taskScopeForWorkspace,
    resolveTask,
  };
};

export type OdtMcpToolContext = ReturnType<typeof createOdtMcpToolContext>;

const callerBridgeBodySchema = z.record(z.string(), z.json());

/** Splits the native caller of a managed session from the tool input of a bridge body. */
export const splitBridgeCaller = (toolName: OdtToolName, body: JSONType) =>
  parseToolInput(toolName, callerBridgeBodySchema, body).pipe(
    Effect.map(({ caller, ...input }) => ({ caller, input })),
  );

/**
 * The saved root session of a managed caller. A call without a caller comes from a user client
 * and has no owner. A task session may act only on its own task.
 */
export const resolveTaskCaller = (
  context: OdtMcpToolContext,
  toolName: OdtToolName,
  rawCaller: JSONType | undefined,
  workspaceId: string,
  taskId: string,
  action: string,
): Effect.Effect<RuntimeSessionOwner | undefined, OdtMcpBridgeError> =>
  Effect.gen(function* () {
    if (rawCaller === undefined) return undefined;
    const caller = yield* parseToolInput(toolName, odtBrowserCallerSchema, rawCaller);
    const owner = yield* context.managedCallers.resolve({ workspaceId, caller });
    if (owner.kind === "task" && owner.taskId !== taskId) {
      return yield* new HostValidationError({
        field: "taskId",
        message: `Managed task sessions can ${action} only for their own task.`,
      });
    }
    return owner;
  });

const taskReferenceError = (cause: unknown) =>
  new HostValidationError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
    details: {
      operation: "odt_mcp_bridge.resolve_task_reference",
    },
  });
