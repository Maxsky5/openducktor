import type {
  AcceptedAgentUserMessage,
  AgentSessionControlForkInput,
  AgentSessionControlResumeInput,
  AgentSessionControlSendInput,
  AgentSessionControlStartInput,
  AgentSessionLiveLoadContextInput,
  AgentSessionLiveReplyApprovalInput,
  AgentSessionLiveReplyQuestionInput,
  AgentSessionUserMessagePart,
  RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentEvent,
  AgentRuntimePolicyBinding,
  AgentUserMessagePart,
  ForkAgentSessionInput,
  LoadAgentSessionHistoryInput,
  ReplyApprovalInput,
  ReplyQuestionInput,
  ResumeAgentSessionInput,
  SendAgentUserMessageInput,
  StartAgentSessionInput,
} from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";

type ClaudeRuntimePolicyBinding = Extract<
  AgentRuntimePolicyBinding,
  { readonly runtimeKind: "claude" }
>;

const CLAUDE_RUNTIME_POLICY_BINDING = {
  runtimeKind: "claude",
  runtimePolicy: { kind: "claude" },
} as const satisfies ClaudeRuntimePolicyBinding;

export const requireClaudePolicy = (
  runtimeKind: RuntimeKind,
  operation: string,
): Effect.Effect<ClaudeRuntimePolicyBinding, HostValidationError> => {
  if (runtimeKind !== "claude") {
    return Effect.fail(
      new HostValidationError({
        field: "runtimeKind",
        message: `Claude live-session control '${operation}' requires a Claude runtime.`,
        details: { operation, runtimeKind },
      }),
    );
  }
  return Effect.succeed(CLAUDE_RUNTIME_POLICY_BINDING);
};

export const toClaudeLoadContextInput = (
  input: AgentSessionLiveLoadContextInput,
  binding: ClaudeRuntimePolicyBinding,
): LoadAgentSessionHistoryInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  externalSessionId: input.externalSessionId,
  ...binding,
  ...(input.sessionScope === undefined ? {} : { sessionScope: input.sessionScope }),
});

export const toClaudeReplyApprovalInput = (
  input: AgentSessionLiveReplyApprovalInput,
  binding: ClaudeRuntimePolicyBinding,
): ReplyApprovalInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  externalSessionId: input.externalSessionId,
  requestId: input.requestId,
  outcome: input.outcome,
  ...binding,
  ...(input.message === undefined ? {} : { message: input.message }),
});

export const toClaudeReplyQuestionInput = (
  input: AgentSessionLiveReplyQuestionInput,
  binding: ClaudeRuntimePolicyBinding,
): ReplyQuestionInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  externalSessionId: input.externalSessionId,
  requestId: input.requestId,
  answers: input.answers,
  ...binding,
});

export const toClaudeStartInput = (
  input: AgentSessionControlStartInput,
  binding: ClaudeRuntimePolicyBinding,
): StartAgentSessionInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  sessionScope: input.sessionScope,
  systemPrompt: input.systemPrompt,
  ...binding,
  ...(input.model === undefined ? {} : { model: input.model }),
});

export const toClaudeResumeInput = (
  input: AgentSessionControlResumeInput,
  binding: ClaudeRuntimePolicyBinding,
): ResumeAgentSessionInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  externalSessionId: input.externalSessionId,
  sessionScope: input.sessionScope,
  ...binding,
  ...(input.model === undefined ? {} : { model: input.model }),
  ...(input.systemPrompt === undefined ? {} : { systemPrompt: input.systemPrompt }),
});

export const toClaudeForkInput = (
  input: AgentSessionControlForkInput,
  binding: ClaudeRuntimePolicyBinding,
): ForkAgentSessionInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  sessionScope: input.sessionScope,
  systemPrompt: input.systemPrompt,
  parentExternalSessionId: input.parentExternalSessionId,
  ...binding,
  ...(input.model === undefined ? {} : { model: input.model }),
  ...(input.runtimeHistoryAnchor === undefined
    ? {}
    : { runtimeHistoryAnchor: input.runtimeHistoryAnchor }),
});

const toClaudeUserMessagePart = (part: AgentSessionUserMessagePart): AgentUserMessagePart => {
  if (part.kind !== "attachment") {
    return part;
  }
  return {
    kind: "attachment",
    attachment: {
      id: part.attachment.id,
      path: part.attachment.path,
      name: part.attachment.name,
      kind: part.attachment.kind,
      ...(part.attachment.mime === undefined ? {} : { mime: part.attachment.mime }),
    },
  };
};

export const toClaudeSendInput = (
  input: AgentSessionControlSendInput,
  binding: ClaudeRuntimePolicyBinding,
): SendAgentUserMessageInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  externalSessionId: input.externalSessionId,
  sessionScope: input.sessionScope,
  parts: input.parts.map(toClaudeUserMessagePart),
  ...binding,
  ...(input.model === undefined ? {} : { model: input.model }),
  ...(input.systemPrompt === undefined ? {} : { systemPrompt: input.systemPrompt }),
});

export const toClaudeRuntimeUserMessageEvent = (
  event: AcceptedAgentUserMessage,
): Extract<AgentEvent, { readonly type: "user_message" }> => ({
  type: event.type,
  externalSessionId: event.externalSessionId,
  timestamp: event.timestamp,
  messageId: event.messageId,
  message: event.message,
  parts: event.parts,
  state: event.state,
  ...(event.model === undefined ? {} : { model: event.model }),
});
