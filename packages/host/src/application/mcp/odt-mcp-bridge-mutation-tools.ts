import {
  type ApplyWorkflowEventResult,
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
  type WorkflowAgentEventEffect,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType, z } from "zod";
import { TaskPolicyError } from "../../domain/task";
import { HostValidationError } from "../../effect/host-errors";
import { executeSetTaskArtifact, executeDeleteTaskArtifact } from "./odt-mcp-artifact-tools";
import {
  buildTaskUpdatePatch,
  mapPublicTask,
  mapTaskSummary,
  parseResponse,
  parseToolInput,
} from "./odt-mcp-bridge-model";
import {
  type OdtMcpBridgeError,
  type OdtMcpMutationToolName,
  type OdtMcpToolContext,
  resolveTaskCaller,
  splitBridgeCaller,
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
    const { workspaceScopeForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput(
      "odt_create_task",
      ODT_TOOL_SCHEMAS.odt_create_task,
      input,
    );
    const { workspaceId, repoPath } = yield* workspaceScopeForWorkspace(parsed.workspaceId ?? "");
    const created = yield* taskService.createTask({
      workspaceId,
      repoPath,
      task: {
        title: parsed.title,
        issueType: parsed.issueType,
        priority: parsed.priority,
        description: parsed.description,
        labels: parsed.labels,
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
    const { taskScopeForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput(
      "odt_update_task",
      ODT_TOOL_SCHEMAS.odt_update_task,
      input,
    );
    const { workspaceId, repoPath, task } = yield* taskScopeForWorkspace(
      parsed.workspaceId ?? "",
      parsed.taskId,
    );
    const patch = buildTaskUpdatePatch(task, parsed);
    if (Object.keys(patch).length === 0) {
      return yield* parseResponse(
        "odt_update_task",
        RESPONSE_SCHEMAS.odt_update_task,
        mapTaskSummary(task),
      );
    }
    const updated = yield* taskService.updateTask({
      workspaceId,
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

/**
 * Sends an agent event of the task workflow. A managed task session may send only the events that
 * its role may send, for its own task. A user client may send every agent event.
 */
const executeApplyWorkflowEvent: OdtMcpMutationHandler = (context, body) =>
  Effect.gen(function* () {
    const { caller: rawCaller, input: toolBody } = yield* splitBridgeCaller(
      "odt_apply_workflow_event",
      body,
    );
    const parsed = yield* parseToolInput(
      "odt_apply_workflow_event",
      ODT_TOOL_SCHEMAS.odt_apply_workflow_event,
      toolBody,
    );
    const { workspaceId, repoPath, task } = yield* context.taskScopeForWorkspace(
      parsed.workspaceId ?? "",
      parsed.taskId,
    );
    const owner = yield* resolveTaskCaller(
      context,
      "odt_apply_workflow_event",
      rawCaller,
      parsed.workspaceId ?? "",
      task.id,
      "send workflow events",
    );
    const workflow = context.taskWorkflows.forTask(task);
    const event = workflow.agentEvent(parsed.eventId);
    if (event === undefined) {
      return yield* TaskPolicyError.policy(
        `Task workflow "${workflow.definition.id}" has no agent event ${parsed.eventId}. Use an event that your role instructions list.`,
      );
    }
    if (owner?.kind === "task" && !event.roles.includes(owner.role)) {
      const allowed = workflow.agentEvents(owner.role).map(({ id }) => id);
      return yield* TaskPolicyError.policy(
        `The ${owner.role} role cannot send ${parsed.eventId}. ${allowed.length > 0 ? `Use ${allowed.join(", ")}.` : "The role has no workflow events."}`,
      );
    }
    if (event.note === "required" && parsed.note === undefined) {
      return yield* new HostValidationError({
        field: "note",
        message: `${parsed.eventId} requires a note. Say why you send the event.`,
      });
    }
    const scope = { workspaceId, repoPath, taskId: task.id };
    const updated = yield* applyAgentEventEffect(context, scope, parsed.eventId, event.effect);
    const response: ApplyWorkflowEventResult = {
      task: mapPublicTask(updated),
      eventId: parsed.eventId,
    };
    if (parsed.note !== undefined) response.note = parsed.note;
    return yield* parseResponse(
      "odt_apply_workflow_event",
      RESPONSE_SCHEMAS.odt_apply_workflow_event,
      response,
    );
  });

/** Runs the host effect of an agent event. An event without one only changes the task status. */
const applyAgentEventEffect = (
  context: OdtMcpToolContext,
  scope: { workspaceId: string; repoPath: string; taskId: string },
  eventId: string,
  effect: WorkflowAgentEventEffect | undefined,
) => {
  switch (effect) {
    case "build.blocked":
      return context.taskService.buildBlocked(scope);
    case "build.resumed":
      return context.taskService.buildResumed(scope);
    case "build.completed":
      return context.taskService.buildCompleted(scope);
    case undefined:
    case "status.set":
      return context.taskService.applyAgentEvent({ ...scope, eventId });
  }
};

const executeSetPullRequest: OdtMcpMutationHandler = (context, input) =>
  Effect.gen(function* () {
    const { taskScopeForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput(
      "odt_set_pull_request",
      ODT_TOOL_SCHEMAS.odt_set_pull_request,
      input,
    );
    const { workspaceId, repoPath, task } = yield* taskScopeForWorkspace(
      parsed.workspaceId ?? "",
      parsed.taskId,
    );
    const pullRequest = yield* taskService.linkPullRequest({
      workspaceId,
      repoPath,
      taskId: task.id,
      number: parsed.number,
    });
    const updated = yield* context.taskForWorkspace(workspaceId, task.id);
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
  odt_apply_workflow_event: executeApplyWorkflowEvent,
  odt_set_pull_request: executeSetPullRequest,
} satisfies Record<OdtMcpMutationToolName, OdtMcpMutationHandler>;
