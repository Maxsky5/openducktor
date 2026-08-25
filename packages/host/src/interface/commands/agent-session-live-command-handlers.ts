import {
  type AgentSessionControlSendInput,
  type AgentSessionUserMessagePart,
  agentSessionControlForkInputSchema,
  agentSessionControlReleaseInputSchema,
  agentSessionControlResumeInputSchema,
  agentSessionControlSendInputSchema,
  agentSessionControlStartInputSchema,
  agentSessionControlStopInputSchema,
  agentSessionControlUpdateModelInputSchema,
  agentSessionLiveListInputSchema,
  agentSessionLiveLoadContextInputSchema,
  agentSessionLiveLoadDiffInputSchema,
  agentSessionLiveReadInputSchema,
  agentSessionLiveRefreshInputSchema,
  agentSessionLiveReplyApprovalInputSchema,
  agentSessionLiveReplyQuestionInputSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { z } from "zod";
import type { AgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import type {
  LocalAttachmentService,
  LocalAttachmentServiceError,
} from "../../application/attachments/local-attachment-service";
import { HostValidationError } from "../../effect/host-errors";
import { defineHostCommandHandlers } from "../router/host-command-router";

const parseCommandInput = <Output>(
  schema: z.ZodType<Output>,
  args: Record<string, unknown> | undefined,
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

type LocalAttachmentResolver = Pick<LocalAttachmentService, "resolve">;

const resolveSendInputPart = (
  part: AgentSessionUserMessagePart,
  attachmentResolver: LocalAttachmentResolver,
): Effect.Effect<AgentSessionUserMessagePart, LocalAttachmentServiceError> =>
  Effect.gen(function* () {
    if (part.kind !== "attachment") {
      return part;
    }
    const { path } = yield* attachmentResolver.resolve({ path: part.attachment.path });
    return {
      ...part,
      attachment: { ...part.attachment, path },
    };
  });

const resolveSendInputAttachments = (
  input: AgentSessionControlSendInput,
  attachmentResolver: LocalAttachmentResolver,
) =>
  Effect.forEach(input.parts, (part) => resolveSendInputPart(part, attachmentResolver)).pipe(
    Effect.map((parts) => ({ ...input, parts })),
  );

export const createAgentSessionLiveCommandHandlers = (
  service: AgentSessionLiveStateService,
  attachmentResolver: LocalAttachmentResolver,
) =>
  defineHostCommandHandlers({
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
      parseCommandInput(
        agentSessionControlResumeInputSchema,
        args,
        "agent_session_control_resume",
      ).pipe(Effect.flatMap(service.resumeSession)),
    agent_session_control_send: (args) =>
      parseCommandInput(
        agentSessionControlSendInputSchema,
        args,
        "agent_session_control_send",
      ).pipe(
        Effect.flatMap((input) => resolveSendInputAttachments(input, attachmentResolver)),
        Effect.flatMap(service.sendUserMessage),
      ),
    agent_session_control_start: (args) =>
      parseCommandInput(
        agentSessionControlStartInputSchema,
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
  });
