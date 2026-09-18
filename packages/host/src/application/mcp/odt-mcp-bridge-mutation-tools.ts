import {
  type BuildBlockedResult,
  type BuildCompletedResult,
  type BuildResumedResult,
  type CreateTaskResult,
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
  type QaApprovedResult,
  type QaRejectedResult,
  type SetPlanResult,
  type SetPullRequestResult,
  type SetSpecResult,
  type TaskSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import type { TaskService } from "../tasks/task-service";
import {
  buildTaskUpdatePatch,
  createdSubtaskIds,
  directSubtaskIds,
  mapPublicTask,
  mapTaskSummary,
  parseResponse,
  parseToolInput,
  persistedDocument,
} from "./odt-mcp-bridge-model";
import type {
  OdtMcpBridgeError,
  OdtMcpMutationToolName,
  OdtMcpToolContext,
} from "./odt-mcp-bridge-tool-context";

const RESPONSE_SCHEMAS = ODT_HOST_BRIDGE_RESPONSE_SCHEMAS;

export type OdtMcpMutationToolResult =
  | BuildBlockedResult
  | BuildCompletedResult
  | BuildResumedResult
  | CreateTaskResult
  | QaApprovedResult
  | QaRejectedResult
  | SetPlanResult
  | SetPullRequestResult
  | SetSpecResult
  | TaskSummary;

export const executeOdtMcpMutationTool = (
  context: OdtMcpToolContext,
  toolName: OdtMcpMutationToolName,
  input: JSONType,
): Effect.Effect<OdtMcpMutationToolResult, OdtMcpBridgeError> => {
  const {
    repoPathForWorkspace,
    resolveTask,
    taskForWorkspace,
    tasksForWorkspace,
    taskService,
    workspaceSettingsService,
  } = context;

  return Effect.gen(function* () {
    switch (toolName) {
      case "odt_create_task": {
        const parsed = yield* parseToolInput(toolName, ODT_TOOL_SCHEMAS[toolName], input);
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
      case "odt_update_task": {
        const parsed = yield* parseToolInput(toolName, ODT_TOOL_SCHEMAS[toolName], input);
        const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
        const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
        if (task.issueType === "epic") {
          return yield* new HostValidationError({
            field: "taskId",
            message: "Epic tasks cannot be updated by the public MCP update tool.",
            details: { taskId: task.id },
          });
        }
        const patch = buildTaskUpdatePatch(task, parsed);
        if (Object.keys(patch).length === 0) {
          return yield* parseResponse(
            toolName,
            RESPONSE_SCHEMAS.odt_update_task,
            mapTaskSummary(task),
          );
        }
        const updated = yield* taskService.updateTask({
          repoPath,
          taskId: task.id,
          patch,
        });
        return yield* parseResponse(
          toolName,
          RESPONSE_SCHEMAS.odt_update_task,
          mapTaskSummary(updated),
        );
      }
      case "odt_set_spec": {
        const parsed = yield* parseToolInput(toolName, ODT_TOOL_SCHEMAS[toolName], input);
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
        const parsed = yield* parseToolInput(toolName, ODT_TOOL_SCHEMAS[toolName], input);
        const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
        const beforeTasks = yield* tasksForWorkspace(parsed.workspaceId ?? "");
        const task = yield* resolveTask(beforeTasks, parsed.taskId);
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
        const updated = yield* resolveTask(afterTasks, task.id);
        return yield* parseResponse(toolName, RESPONSE_SCHEMAS.odt_set_plan, {
          task: mapPublicTask(updated),
          document: persistedDocument(document, toolName),
          createdSubtaskIds: createdSubtaskIds(previousSubtaskIds, afterTasks, task.id),
        });
      }
      case "odt_build_blocked": {
        const parsed = yield* parseToolInput(toolName, ODT_TOOL_SCHEMAS[toolName], input);
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
        const parsed = yield* parseToolInput(toolName, ODT_TOOL_SCHEMAS[toolName], input);
        const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
        const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
        const updated = yield* taskService.buildResumed({ repoPath, taskId: task.id });
        return yield* parseResponse(toolName, RESPONSE_SCHEMAS.odt_build_resumed, {
          task: mapPublicTask(updated),
        });
      }
      case "odt_build_completed": {
        const parsed = yield* parseToolInput(toolName, ODT_TOOL_SCHEMAS[toolName], input);
        const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
        const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
        const completionInput: Parameters<TaskService["buildCompleted"]>[0] = {
          repoPath,
          taskId: task.id,
        };
        if (parsed.summary !== undefined) {
          completionInput.summary = parsed.summary;
        }
        const updated = yield* taskService.buildCompleted(completionInput);
        const response: BuildCompletedResult = {
          task: mapPublicTask(updated),
        };
        if (parsed.summary !== undefined) {
          response.summary = parsed.summary;
        }
        return yield* parseResponse(toolName, RESPONSE_SCHEMAS.odt_build_completed, response);
      }
      case "odt_set_pull_request": {
        const parsed = yield* parseToolInput(toolName, ODT_TOOL_SCHEMAS[toolName], input);
        const repoConfig = yield* workspaceSettingsService.getRepoConfig(parsed.workspaceId ?? "");
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
        const parsed = yield* parseToolInput(toolName, ODT_TOOL_SCHEMAS[toolName], input);
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
        const parsed = yield* parseToolInput(toolName, ODT_TOOL_SCHEMAS[toolName], input);
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
};
