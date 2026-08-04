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
): Effect.Effect<void, HostValidationError> => {
  if (runtimeKind !== "claude") {
    return Effect.fail(
      new HostValidationError({
        field: "runtimeKind",
        message: `Claude live-session control '${operation}' requires a Claude runtime.`,
        details: { operation, runtimeKind },
      }),
    );
  }
  return Effect.void;
};

export const toClaudeLoadContextInput = (
  input: AgentSessionLiveLoadContextInput,
): LoadAgentSessionHistoryInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  externalSessionId: input.externalSessionId,
  ...CLAUDE_RUNTIME_POLICY_BINDING,
  ...(input.sessionScope === undefined ? {} : { sessionScope: input.sessionScope }),
});

export const toClaudeReplyApprovalInput = (
  input: AgentSessionLiveReplyApprovalInput,
): ReplyApprovalInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  externalSessionId: input.externalSessionId,
  requestId: input.requestId,
  outcome: input.outcome,
  ...CLAUDE_RUNTIME_POLICY_BINDING,
  ...(input.message === undefined ? {} : { message: input.message }),
});

export const toClaudeReplyQuestionInput = (
  input: AgentSessionLiveReplyQuestionInput,
): ReplyQuestionInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  externalSessionId: input.externalSessionId,
  requestId: input.requestId,
  answers: input.answers,
  ...CLAUDE_RUNTIME_POLICY_BINDING,
});

export const toClaudeStartInput = (
  input: AgentSessionControlStartInput,
): StartAgentSessionInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  sessionScope: input.sessionScope,
  systemPrompt: input.systemPrompt,
  ...CLAUDE_RUNTIME_POLICY_BINDING,
  ...(input.model === undefined ? {} : { model: input.model }),
});

export const toClaudeResumeInput = (
  input: AgentSessionControlResumeInput,
): ResumeAgentSessionInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  externalSessionId: input.externalSessionId,
  sessionScope: input.sessionScope,
  ...CLAUDE_RUNTIME_POLICY_BINDING,
  ...(input.model === undefined ? {} : { model: input.model }),
  ...(input.systemPrompt === undefined ? {} : { systemPrompt: input.systemPrompt }),
});

export const toClaudeForkInput = (input: AgentSessionControlForkInput): ForkAgentSessionInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  sessionScope: input.sessionScope,
  systemPrompt: input.systemPrompt,
  parentExternalSessionId: input.parentExternalSessionId,
  ...CLAUDE_RUNTIME_POLICY_BINDING,
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
): SendAgentUserMessageInput => ({
  repoPath: input.repoPath,
  workingDirectory: input.workingDirectory,
  externalSessionId: input.externalSessionId,
  sessionScope: input.sessionScope,
  parts: input.parts.map(toClaudeUserMessagePart),
  ...CLAUDE_RUNTIME_POLICY_BINDING,
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
