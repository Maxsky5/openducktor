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
): Effect.Effect<
  void,
  HostValidationError<{
    readonly operation: string;
    readonly runtimeKind: Exclude<RuntimeKind, "claude">;
  }>
> => {
  if (runtimeKind !== "claude") {
    return Effect.fail(
      new HostValidationError<{
        readonly operation: string;
        readonly runtimeKind: Exclude<RuntimeKind, "claude">;
      }>({
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
): LoadAgentSessionHistoryInput => {
  const result: LoadAgentSessionHistoryInput = {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    externalSessionId: input.externalSessionId,
    ...CLAUDE_RUNTIME_POLICY_BINDING,
  };
  if (input.sessionScope !== undefined) {
    result.sessionScope = input.sessionScope;
  }
  return result;
};

export const toClaudeReplyApprovalInput = (
  input: AgentSessionLiveReplyApprovalInput,
): ReplyApprovalInput => {
  const result: ReplyApprovalInput = {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    externalSessionId: input.externalSessionId,
    requestId: input.requestId,
    outcome: input.outcome,
    ...CLAUDE_RUNTIME_POLICY_BINDING,
  };
  if (input.message !== undefined) {
    result.message = input.message;
  }
  return result;
};

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
): StartAgentSessionInput => {
  const result: StartAgentSessionInput = {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    sessionScope: input.sessionScope,
    systemPrompt: input.systemPrompt,
    ...CLAUDE_RUNTIME_POLICY_BINDING,
  };
  if (input.model !== undefined) {
    result.model = input.model;
  }
  return result;
};

export const toClaudeResumeInput = (
  input: AgentSessionControlResumeInput,
): ResumeAgentSessionInput => {
  const result: ResumeAgentSessionInput = {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    externalSessionId: input.externalSessionId,
    sessionScope: input.sessionScope,
    ...CLAUDE_RUNTIME_POLICY_BINDING,
  };
  if (input.model !== undefined) {
    result.model = input.model;
  }
  if (input.systemPrompt !== undefined) {
    result.systemPrompt = input.systemPrompt;
  }
  return result;
};

export const toClaudeForkInput = (input: AgentSessionControlForkInput): ForkAgentSessionInput => {
  const result: ForkAgentSessionInput = {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    sessionScope: input.sessionScope,
    systemPrompt: input.systemPrompt,
    parentExternalSessionId: input.parentExternalSessionId,
    ...CLAUDE_RUNTIME_POLICY_BINDING,
  };
  if (input.model !== undefined) {
    result.model = input.model;
  }
  if (input.runtimeHistoryAnchor !== undefined) {
    result.runtimeHistoryAnchor = input.runtimeHistoryAnchor;
  }
  return result;
};

const toClaudeUserMessagePart = (part: AgentSessionUserMessagePart): AgentUserMessagePart => {
  if (part.kind !== "attachment") {
    return part;
  }
  const attachment: Extract<AgentUserMessagePart, { kind: "attachment" }>["attachment"] = {
    id: part.attachment.id,
    path: part.attachment.path,
    name: part.attachment.name,
    kind: part.attachment.kind,
  };
  if (part.attachment.mime !== undefined) {
    attachment.mime = part.attachment.mime;
  }
  return {
    kind: "attachment",
    attachment,
  };
};

export const toClaudeSendInput = (
  input: AgentSessionControlSendInput,
): SendAgentUserMessageInput => {
  const result: SendAgentUserMessageInput = {
    repoPath: input.repoPath,
    workingDirectory: input.workingDirectory,
    externalSessionId: input.externalSessionId,
    sessionScope: input.sessionScope,
    parts: input.parts.map(toClaudeUserMessagePart),
    ...CLAUDE_RUNTIME_POLICY_BINDING,
  };
  if (input.model !== undefined) {
    result.model = input.model;
  }
  if (input.systemPrompt !== undefined) {
    result.systemPrompt = input.systemPrompt;
  }
  return result;
};

export const toClaudeRuntimeUserMessageEvent = (
  event: AcceptedAgentUserMessage,
): Extract<AgentEvent, { readonly type: "user_message" }> => {
  const result: Extract<AgentEvent, { readonly type: "user_message" }> = {
    type: event.type,
    externalSessionId: event.externalSessionId,
    timestamp: event.timestamp,
    messageId: event.messageId,
    message: event.message,
    parts: event.parts,
    state: event.state,
  };
  if (event.model !== undefined) {
    result.model = event.model;
  }
  return result;
};
