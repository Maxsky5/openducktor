import {
  type BuildCompletedResult,
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType, z } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import type { TaskService } from "../tasks/task-service";
import { executeSetTaskArtifact, executeDeleteTaskArtifact } from "./odt-mcp-artifact-tools";
import {
  buildTaskUpdatePatch,
  mapPublicTask,
  mapTaskSummary,
  parseResponse,
  parseToolInput,
} from "./odt-mcp-bridge-model";
import type {
  OdtMcpBridgeError,
  OdtMcpMutationToolName,
  OdtMcpToolContext,
} from "./odt-mcp-bridge-tool-context";

const RESPONSE_SCHEMAS = ODT_HOST_BRIDGE_RESPONSE_SCHEMAS;

type OdtMcpMutationToolResult = z.output<
  (typeof ODT_HOST_BRIDGE_RESPONSE_SCHEMAS)[OdtMcpMutationToolName]
>;

type OdtMcpMutationHandler = (
  context: OdtMcpToolContext,
  input: JSONType,
) => Effect.Effect<OdtMcpMutationToolResult, OdtMcpBridgeError>;

export const executeOdtMcpMutationTool = (
  context: OdtMcpToolContext,
  toolName: OdtMcpMutationToolName,
  input: JSONType,
): Effect.Effect<OdtMcpMutationToolResult, OdtMcpBridgeError> =>
  MUTATION_HANDLERS[toolName](context, input);

const executeCreateTask: OdtMcpMutationHandler = (context, input) =>
  Effect.gen(function* () {
    const { repoPathForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput(
      "odt_create_task",
      ODT_TOOL_SCHEMAS.odt_create_task,
      input,
    );
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
      "odt_create_task",
      RESPONSE_SCHEMAS.odt_create_task,
      mapTaskSummary(created),
    );
  });

const executeUpdateTask: OdtMcpMutationHandler = (context, input) =>
  Effect.gen(function* () {
    const { repoPathForWorkspace, taskForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput(
      "odt_update_task",
      ODT_TOOL_SCHEMAS.odt_update_task,
      input,
    );
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
        "odt_update_task",
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
      "odt_update_task",
      RESPONSE_SCHEMAS.odt_update_task,
      mapTaskSummary(updated),
    );
  });

const executeBuildBlocked: OdtMcpMutationHandler = (context, input) =>
  Effect.gen(function* () {
    const { repoPathForWorkspace, taskForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput(
      "odt_build_blocked",
      ODT_TOOL_SCHEMAS.odt_build_blocked,
      input,
    );
    const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
    const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
    const updated = yield* taskService.buildBlocked({
      repoPath,
      taskId: task.id,
      reason: parsed.reason,
    });
    return yield* parseResponse("odt_build_blocked", RESPONSE_SCHEMAS.odt_build_blocked, {
      task: mapPublicTask(updated),
      reason: parsed.reason.trim(),
    });
  });

const executeBuildResumed: OdtMcpMutationHandler = (context, input) =>
  Effect.gen(function* () {
    const { repoPathForWorkspace, taskForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput(
      "odt_build_resumed",
      ODT_TOOL_SCHEMAS.odt_build_resumed,
      input,
    );
    const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
    const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
    const updated = yield* taskService.buildResumed({ repoPath, taskId: task.id });
    return yield* parseResponse("odt_build_resumed", RESPONSE_SCHEMAS.odt_build_resumed, {
      task: mapPublicTask(updated),
    });
  });

const executeBuildCompleted: OdtMcpMutationHandler = (context, input) =>
  Effect.gen(function* () {
    const { repoPathForWorkspace, taskForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput(
      "odt_build_completed",
      ODT_TOOL_SCHEMAS.odt_build_completed,
      input,
    );
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
    return yield* parseResponse(
      "odt_build_completed",
      RESPONSE_SCHEMAS.odt_build_completed,
      response,
    );
  });

const executeSetPullRequest: OdtMcpMutationHandler = (context, input) =>
  Effect.gen(function* () {
    const { repoPathForWorkspace, taskForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput(
      "odt_set_pull_request",
      ODT_TOOL_SCHEMAS.odt_set_pull_request,
      input,
    );
    const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
    const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
    const pullRequest = yield* taskService.linkPullRequest({
      repoPath,
      taskId: task.id,
      number: parsed.number,
    });
    const updated = yield* taskForWorkspace(parsed.workspaceId ?? "", task.id);
    return yield* parseResponse("odt_set_pull_request", RESPONSE_SCHEMAS.odt_set_pull_request, {
      task: mapPublicTask(updated),
      pullRequest,
    });
  });

const MUTATION_HANDLERS = {
  odt_set_task_artifact: executeSetTaskArtifact,
  odt_delete_task_artifact: executeDeleteTaskArtifact,

  odt_create_task: executeCreateTask,
  odt_update_task: executeUpdateTask,
  odt_build_blocked: executeBuildBlocked,
  odt_build_resumed: executeBuildResumed,
  odt_build_completed: executeBuildCompleted,
  odt_set_pull_request: executeSetPullRequest,
} satisfies Record<OdtMcpMutationToolName, OdtMcpMutationHandler>;
