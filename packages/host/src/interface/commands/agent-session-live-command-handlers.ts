import { workflowLaunchRequestSchema } from "@openducktor/contracts";
import type { WorkflowLaunchService } from "../../application/agent-sessions/workflow-launch-service";
import {
  type AgentRepositorySessionStartInput,
  type AgentSessionControlSummary,
  type AgentWorkflowSessionStartInput,
  agentRepositorySessionStartInputSchema,
  agentSessionControlForkInputSchema,
  agentSessionControlReleaseInputSchema,
  agentSessionResumeIntentSchema,
  agentSessionControlStopInputSchema,
  agentSessionControlUpdateModelInputSchema,
  agentSessionLiveAttachInputSchema,
  agentSessionLiveListInputSchema,
  agentSessionLiveLoadContextInputSchema,
  agentSessionLiveLoadDiffInputSchema,
  agentSessionLiveReadInputSchema,
  agentSessionLiveRefreshInputSchema,
  agentSessionLiveReplyApprovalInputSchema,
  agentSessionLiveReplyQuestionInputSchema,
  agentMessageQueueManageInputSchema,
  agentMessageSubmitInputSchema,
  agentWorkflowSessionStartInputSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { AgentMessageDeliveryService } from "../../application/agent-sessions/agent-message-delivery-service";
import type { AgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import type { TaskServiceError } from "../../application/tasks/task-service";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import type { z } from "zod";
import type { HostCommandArgs } from "./command-inputs";
import { WorkflowIntentRejectedError } from "../../ports/workflow-intent-rejected-error";
import { SessionOperationError } from "../../ports/session-operation-error";

const parseCommandInput = <Output>(
  schema: z.ZodType<Output>,
  args: HostCommandArgs,
  command: string,
) =>
  Effect.try({
    try: () => schema.parse(args),
    catch: (cause) =>
      new HostValidationError({
        message: cause instanceof Error ? cause.message : String(cause),
        field: "args",
        cause,
        details: { command },
      }),
  });

type AgentSessionCommandService = Omit<AgentSessionLiveStateService, "startSession"> & {
  startSession: (
    input: AgentRepositorySessionStartInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError | TaskServiceError>;
  startWorkflowSession: (
    input: AgentWorkflowSessionStartInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError | TaskServiceError>;
};

export const createAgentSessionLiveCommandHandlers = (
  service: AgentSessionCommandService,
  messageDelivery: Pick<AgentMessageDeliveryService, "submit" | "manage">,
) =>
  ({
    agent_session_control_fork: (args) =>
      parseCommandInput(
        agentSessionControlForkInputSchema,
        args,
        "agent_session_control_fork",
      ).pipe(Effect.flatMap(service.forkSession)),
    agent_session_control_release: (args) =>
      parseCommandInput(
        agentSessionControlReleaseInputSchema,
        args,
        "agent_session_control_release",
      ).pipe(Effect.flatMap(service.releaseSession)),
    agent_session_control_resume: (args) =>
      parseCommandInput(agentSessionResumeIntentSchema, args, "agent_session_control_resume").pipe(
        Effect.flatMap(service.resumeSession),
      ),
    agent_session_message_submit: (args) =>
      parseCommandInput(agentMessageSubmitInputSchema, args, "agent_session_message_submit").pipe(
        Effect.flatMap(messageDelivery.submit),
        Effect.mapError((error) =>
          error instanceof SessionOperationError ? error : new WorkflowIntentRejectedError(error),
        ),
      ),
    agent_session_message_queue_manage: (args) =>
      parseCommandInput(
        agentMessageQueueManageInputSchema,
        args,
        "agent_session_message_queue_manage",
      ).pipe(Effect.flatMap(messageDelivery.manage)),
    agent_session_control_start: (args) =>
      parseCommandInput(
        agentRepositorySessionStartInputSchema,
        args,
        "agent_session_control_start",
      ).pipe(Effect.flatMap(service.startSession)),
    agent_session_control_stop: (args) =>
      parseCommandInput(
        agentSessionControlStopInputSchema,
        args,
        "agent_session_control_stop",
      ).pipe(Effect.flatMap(service.stopSession)),
    agent_session_control_update_model: (args) =>
      parseCommandInput(
        agentSessionControlUpdateModelInputSchema,
        args,
        "agent_session_control_update_model",
      ).pipe(Effect.flatMap(service.updateSessionModel)),
    agent_session_workflow_start: (args) =>
      parseCommandInput(
        agentWorkflowSessionStartInputSchema,
        args,
        "agent_session_workflow_start",
      ).pipe(Effect.flatMap(service.startWorkflowSession)),
    agent_session_live_attach: (args) =>
      parseCommandInput(agentSessionLiveAttachInputSchema, args, "agent_session_live_attach").pipe(
        Effect.flatMap(service.attach),
      ),
    agent_session_live_refresh: (args) =>
      parseCommandInput(
        agentSessionLiveRefreshInputSchema,
        args,
        "agent_session_live_refresh",
      ).pipe(Effect.flatMap(service.refresh)),
    agent_session_live_list: (args) =>
      parseCommandInput(agentSessionLiveListInputSchema, args, "agent_session_live_list").pipe(
        Effect.flatMap(service.list),
      ),
    agent_session_live_load_context: (args) =>
      parseCommandInput(
        agentSessionLiveLoadContextInputSchema,
        args,
        "agent_session_live_load_context",
      ).pipe(Effect.flatMap(service.loadContext)),
    agent_session_live_load_diff: (args) =>
      parseCommandInput(
        agentSessionLiveLoadDiffInputSchema,
        args,
        "agent_session_live_load_diff",
      ).pipe(Effect.flatMap(service.loadSessionDiff)),
    agent_session_live_read: (args) =>
      parseCommandInput(agentSessionLiveReadInputSchema, args, "agent_session_live_read").pipe(
        Effect.flatMap(service.read),
      ),
    agent_session_live_reply_approval: (args) =>
      parseCommandInput(
        agentSessionLiveReplyApprovalInputSchema,
        args,
        "agent_session_live_reply_approval",
      ).pipe(Effect.flatMap(service.replyApproval)),
    agent_session_live_reply_question: (args) =>
      parseCommandInput(
        agentSessionLiveReplyQuestionInputSchema,
        args,
        "agent_session_live_reply_question",
      ).pipe(Effect.flatMap(service.replyQuestion)),
  }) satisfies HostCommandHandlerDefinitions;

export const createWorkflowLaunchCommandHandlers = (workflowLaunchService: WorkflowLaunchService) =>
  ({
    agent_session_workflow_launch: (args) =>
      parseCommandInput(workflowLaunchRequestSchema, args, "agent_session_workflow_launch").pipe(
        Effect.flatMap(workflowLaunchService.launch),
      ),
  }) satisfies HostCommandHandlerDefinitions;
