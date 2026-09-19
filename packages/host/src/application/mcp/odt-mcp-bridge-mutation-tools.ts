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

type OdtMcpMutationToolResult =
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

const executeSetSpec: OdtMcpMutationHandler = (context, input) =>
  Effect.gen(function* () {
    const { repoPathForWorkspace, taskForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput("odt_set_spec", ODT_TOOL_SCHEMAS.odt_set_spec, input);
    const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
    const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
    const document = yield* taskService.setSpec({
      repoPath,
      taskId: task.id,
      markdown: parsed.markdown,
    });
    const updated = yield* taskForWorkspace(parsed.workspaceId ?? "", task.id);
    return yield* parseResponse("odt_set_spec", RESPONSE_SCHEMAS.odt_set_spec, {
      task: mapPublicTask(updated),
      document: persistedDocument(document, "odt_set_spec"),
    });
  });

const executeSetPlan: OdtMcpMutationHandler = (context, input) =>
  Effect.gen(function* () {
    const { repoPathForWorkspace, resolveTask, tasksForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput("odt_set_plan", ODT_TOOL_SCHEMAS.odt_set_plan, input);
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
    return yield* parseResponse("odt_set_plan", RESPONSE_SCHEMAS.odt_set_plan, {
      task: mapPublicTask(updated),
      document: persistedDocument(document, "odt_set_plan"),
      createdSubtaskIds: createdSubtaskIds(previousSubtaskIds, afterTasks, task.id),
    });
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

const executeQaApproved: OdtMcpMutationHandler = (context, input) =>
  Effect.gen(function* () {
    const { repoPathForWorkspace, taskForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput(
      "odt_qa_approved",
      ODT_TOOL_SCHEMAS.odt_qa_approved,
      input,
    );
    const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
    const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
    const updated = yield* taskService.qaApproved({
      repoPath,
      taskId: task.id,
      markdown: parsed.reportMarkdown,
    });
    return yield* parseResponse("odt_qa_approved", RESPONSE_SCHEMAS.odt_qa_approved, {
      task: mapPublicTask(updated),
    });
  });

const executeQaRejected: OdtMcpMutationHandler = (context, input) =>
  Effect.gen(function* () {
    const { repoPathForWorkspace, taskForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput(
      "odt_qa_rejected",
      ODT_TOOL_SCHEMAS.odt_qa_rejected,
      input,
    );
    const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
    const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
    const updated = yield* taskService.qaRejected({
      repoPath,
      taskId: task.id,
      markdown: parsed.reportMarkdown,
    });
    return yield* parseResponse("odt_qa_rejected", RESPONSE_SCHEMAS.odt_qa_rejected, {
      task: mapPublicTask(updated),
    });
  });

const MUTATION_HANDLERS = {
  odt_create_task: executeCreateTask,
  odt_update_task: executeUpdateTask,
  odt_set_spec: executeSetSpec,
  odt_set_plan: executeSetPlan,
  odt_build_blocked: executeBuildBlocked,
  odt_build_resumed: executeBuildResumed,
  odt_build_completed: executeBuildCompleted,
  odt_set_pull_request: executeSetPullRequest,
  odt_qa_approved: executeQaApproved,
  odt_qa_rejected: executeQaRejected,
} satisfies Record<OdtMcpMutationToolName, OdtMcpMutationHandler>;
