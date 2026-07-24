import {
  type BuildBlockedResult,
  type BuildCompletedResult,
  type BuildResumedResult,
  type CreateTaskResult,
  type GetWorkspacesResult,
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_MCP_TOOL_NAMES,
  type OdtHostBridgeReady,
  type QaApprovedResult,
  type QaRejectedResult,
  type SearchTasksResult,
  type SetPlanResult,
  type SetPullRequestResult,
  type SetSpecResult,
  type TaskCard,
  type TaskDocumentsRead,
  type TaskSummary,
  type WorkspaceScopedOdtToolName,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { TaskService, TaskServiceError } from "../tasks/task-service";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";
import {
  activeStatuses,
  createdSubtaskIds,
  directSubtaskIds,
  latestDocument,
  latestQaReport,
  mapPublicTask,
  mapTaskSummary,
  normalizeKey,
  parseResponse,
  parseToolInput,
  persistedDocument,
  resolveTaskReference,
} from "./odt-mcp-bridge-model";

const RESPONSE_SCHEMAS = ODT_HOST_BRIDGE_RESPONSE_SCHEMAS;

const compareTaskSearchResults = (
  left: Pick<TaskCard, "id" | "updatedAt">,
  right: Pick<TaskCard, "id" | "updatedAt">,
): number => {
  const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedAtOrder !== 0) {
    return updatedAtOrder;
  }
  return left.id.localeCompare(right.id);
};

export type OdtMcpBridgeError =
  | HostOperationError
  | HostValidationError
  | TaskServiceError
  | WorkspaceSettingsError;

export type WorkspaceScopedOdtToolResult =
  | BuildBlockedResult
  | BuildCompletedResult
  | BuildResumedResult
  | CreateTaskResult
  | QaApprovedResult
  | QaRejectedResult
  | SearchTasksResult
  | SetPlanResult
  | SetPullRequestResult
  | SetSpecResult
  | TaskDocumentsRead
  | TaskSummary;

export type OdtMcpBridgeService = {
  ready(input?: unknown): Effect.Effect<OdtHostBridgeReady, OdtMcpBridgeError>;
  getWorkspaces(input?: unknown): Effect.Effect<GetWorkspacesResult, OdtMcpBridgeError>;
  invoke(
    toolName: WorkspaceScopedOdtToolName,
    input: unknown,
  ): Effect.Effect<WorkspaceScopedOdtToolResult, OdtMcpBridgeError>;
};
export type CreateOdtMcpBridgeServiceInput = {
  taskService: TaskService;
  workspaceSettingsService: WorkspaceSettingsService;
};
export const createOdtMcpBridgeService = ({
  taskService,
  workspaceSettingsService,
}: CreateOdtMcpBridgeServiceInput): OdtMcpBridgeService => {
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
  const taskForWorkspace = (workspaceId: string, taskId: string) =>
    Effect.gen(function* () {
      const tasks = yield* tasksForWorkspace(workspaceId);
      return yield* Effect.try({
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
    });
  const service: OdtMcpBridgeService = {
    ready() {
      return Effect.succeed({ bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] });
    },
    getWorkspaces(input) {
      return Effect.gen(function* () {
        yield* parseToolInput("odt_get_workspaces", input ?? {});
        return yield* parseResponse("odt_get_workspaces", RESPONSE_SCHEMAS.odt_get_workspaces, {
          workspaces: yield* workspaceSettingsService.listWorkspaces(),
        });
      });
    },
    invoke(toolName, input) {
      return Effect.gen(function* () {
        switch (toolName) {
          case "odt_create_task": {
            const parsed = yield* parseToolInput(toolName, input);
            const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
            const created = yield* taskService.createTask({
              repoPath,
              task: {
                title: parsed.title,
                issueType: parsed.issueType,
                priority: parsed.priority,
                description: parsed.description,
                labels: parsed.labels,
                aiReviewEnabled: parsed.aiReviewEnabled ?? true,
              },
            });
            return yield* parseResponse(
              toolName,
              RESPONSE_SCHEMAS.odt_create_task,
              mapTaskSummary(created),
            );
          }
          case "odt_search_tasks": {
            const parsed = yield* parseToolInput(toolName, input);
            const tasks = (yield* tasksForWorkspace(parsed.workspaceId ?? "")).filter((task) => {
              if (!activeStatuses.has(task.status)) {
                return false;
              }
              if (parsed.priority !== undefined && task.priority !== parsed.priority) {
                return false;
              }
              if (parsed.issueType !== undefined && task.issueType !== parsed.issueType) {
                return false;
              }
              if (parsed.status !== undefined && task.status !== parsed.status) {
                return false;
              }
              if (
                parsed.title !== undefined &&
                !normalizeKey(task.title).includes(normalizeKey(parsed.title))
              ) {
                return false;
              }
              if (parsed.tags !== undefined) {
                const labels = new Set(task.labels.map(normalizeKey));
                return parsed.tags.every((tag) => labels.has(normalizeKey(tag)));
              }
              return true;
            });
            tasks.sort(compareTaskSearchResults);
            const results = tasks.slice(0, parsed.limit).map(mapTaskSummary);
            return yield* parseResponse(toolName, RESPONSE_SCHEMAS.odt_search_tasks, {
              results,
              limit: parsed.limit,
              totalCount: tasks.length,
              hasMore: tasks.length > results.length,
            });
          }
          case "odt_read_task": {
            const parsed = yield* parseToolInput(toolName, input);
            return yield* parseResponse(
              toolName,
              RESPONSE_SCHEMAS.odt_read_task,
              mapTaskSummary(yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId)),
            );
          }
          case "odt_read_task_documents": {
            const parsed = yield* parseToolInput(toolName, input);
            const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
            const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
            const metadata = yield* taskService.getTaskMetadata({ repoPath, taskId: task.id });
            const documents: TaskDocumentsRead["documents"] = {};
            if (parsed.includeSpec) {
              documents.spec = latestDocument(metadata.spec);
            }
            if (parsed.includePlan) {
              documents.implementationPlan = latestDocument(metadata.plan);
            }
            if (parsed.includeQaReport) {
              documents.latestQaReport = latestQaReport(metadata.qaReport);
            }
            return yield* parseResponse(toolName, RESPONSE_SCHEMAS.odt_read_task_documents, {
              documents,
            });
          }
          case "odt_set_spec": {
            const parsed = yield* parseToolInput(toolName, input);
            const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
            const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
            const document = yield* taskService.setSpec({
              repoPath,
              taskId: task.id,
              markdown: parsed.markdown,
            });
            const updated = yield* taskForWorkspace(parsed.workspaceId ?? "", task.id);
            return yield* parseResponse(toolName, RESPONSE_SCHEMAS.odt_set_spec, {
              task: mapPublicTask(updated),
              document: persistedDocument(document, toolName),
            });
          }
          case "odt_set_plan": {
            const parsed = yield* parseToolInput(toolName, input);
            const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
            const beforeTasks = yield* tasksForWorkspace(parsed.workspaceId ?? "");
            const task = yield* Effect.try({
              try: () => resolveTaskReference(beforeTasks, parsed.taskId),
              catch: (cause) =>
                new HostValidationError({
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause,
                  details: {
                    operation: "odt_mcp_bridge.resolve_task_reference",
                  },
                }),
            });
            const previousSubtaskIds = directSubtaskIds(beforeTasks, task.id);
            const plan = yield* taskService.setPlan({
              repoPath,
              taskId: task.id,
              markdown: parsed.markdown,
              subtasks: [],
              hasExplicitSubtasks: false,
            });
            const document = plan.document;
            const afterTasks = yield* tasksForWorkspace(parsed.workspaceId ?? "");
            const updated = yield* Effect.try({
              try: () => resolveTaskReference(afterTasks, task.id),
              catch: (cause) =>
                new HostValidationError({
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause,
                  details: {
                    operation: "odt_mcp_bridge.resolve_task_reference",
                  },
                }),
            });
            return yield* parseResponse(toolName, RESPONSE_SCHEMAS.odt_set_plan, {
              task: mapPublicTask(updated),
              document: persistedDocument(document, toolName),
              createdSubtaskIds: createdSubtaskIds(previousSubtaskIds, afterTasks, task.id),
            });
          }
          case "odt_build_blocked": {
            const parsed = yield* parseToolInput(toolName, input);
            const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
            const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
            const updated = yield* taskService.buildBlocked({
              repoPath,
              taskId: task.id,
              reason: parsed.reason,
            });
            return yield* parseResponse(toolName, RESPONSE_SCHEMAS.odt_build_blocked, {
              task: mapPublicTask(updated),
              reason: parsed.reason.trim(),
            });
          }
          case "odt_build_resumed": {
            const parsed = yield* parseToolInput(toolName, input);
            const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
            const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
            const updated = yield* taskService.buildResumed({ repoPath, taskId: task.id });
            return yield* parseResponse(toolName, RESPONSE_SCHEMAS.odt_build_resumed, {
              task: mapPublicTask(updated),
            });
          }
          case "odt_build_completed": {
            const parsed = yield* parseToolInput(toolName, input);
            const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
            const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
            const updated = yield* taskService.buildCompleted({
              repoPath,
              taskId: task.id,
              ...(parsed.summary === undefined ? {} : { summary: parsed.summary }),
            });
            return yield* parseResponse(toolName, RESPONSE_SCHEMAS.odt_build_completed, {
              task: mapPublicTask(updated),
              ...(parsed.summary === undefined ? {} : { summary: parsed.summary }),
            });
          }
          case "odt_set_pull_request": {
            const parsed = yield* parseToolInput(toolName, input);
            const repoConfig = yield* workspaceSettingsService.getRepoConfig(
              parsed.workspaceId ?? "",
            );
            const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
            const pullRequest = yield* taskService.linkPullRequest({
              repoPath: repoConfig.repoPath,
              taskId: task.id,
              providerId: parsed.providerId,
              number: parsed.number,
            });
            const updated = yield* taskForWorkspace(parsed.workspaceId ?? "", task.id);
            return yield* parseResponse(toolName, RESPONSE_SCHEMAS.odt_set_pull_request, {
              task: mapPublicTask(updated),
              pullRequest,
            });
          }
          case "odt_qa_approved": {
            const parsed = yield* parseToolInput(toolName, input);
            const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
            const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
            const updated = yield* taskService.qaApproved({
              repoPath,
              taskId: task.id,
              markdown: parsed.reportMarkdown,
            });
            return yield* parseResponse(toolName, RESPONSE_SCHEMAS.odt_qa_approved, {
              task: mapPublicTask(updated),
            });
          }
          case "odt_qa_rejected": {
            const parsed = yield* parseToolInput(toolName, input);
            const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
            const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
            const updated = yield* taskService.qaRejected({
              repoPath,
              taskId: task.id,
              markdown: parsed.reportMarkdown,
            });
            return yield* parseResponse(toolName, RESPONSE_SCHEMAS.odt_qa_rejected, {
              task: mapPublicTask(updated),
            });
          }
        }
      });
    },
  };
  return service;
};
