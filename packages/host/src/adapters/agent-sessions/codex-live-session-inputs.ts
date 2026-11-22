import type {
  AgentSessionControlSendInput,
  AgentSessionControlForkInput,
  AgentSessionScope,
} from "@openducktor/contracts";
import type { AgentRuntimePolicyBinding } from "@openducktor/core";
import { toAgentUserMessagePart } from "./agent-user-message-part";
import type { CodexSessionController } from "./codex-live-session-adapter-contract";

type CodexSendRequest = Parameters<CodexSessionController["sendUserMessage"]>[0];

export const toCodexForkRequest = ({
  model,
  runtimeHistoryAnchor,
  sourceWorkingDirectory,
  forkPoint,
  ...requiredInput
}: AgentSessionControlForkInput &
  Extract<AgentRuntimePolicyBinding, { runtimeKind: "codex" }> & {
    sessionScope: AgentSessionScope;
  }): Parameters<CodexSessionController["forkSession"]>[0] => {
  const request: Parameters<CodexSessionController["forkSession"]>[0] = requiredInput;
  if (model !== undefined) request.model = model;
  if (runtimeHistoryAnchor !== undefined) request.runtimeHistoryAnchor = runtimeHistoryAnchor;
  if (sourceWorkingDirectory !== undefined) request.sourceWorkingDirectory = sourceWorkingDirectory;
  if (forkPoint !== undefined) request.forkPoint = forkPoint;
  return request;
};

/** Builds the controller request of a send that carries its Codex policy. */
export const toCodexSendRequest = ({
  resolvedQuestionRequestIds,
  parts,
  systemPrompt,
  submissionId,
  ...requiredInput
}: AgentSessionControlSendInput &
  Extract<AgentRuntimePolicyBinding, { runtimeKind: "codex" }> & {
    sessionScope: AgentSessionScope;
  }): CodexSendRequest => {
  const request: CodexSendRequest = {
    ...requiredInput,
    parts: parts.map(toAgentUserMessagePart),
  };
  if (resolvedQuestionRequestIds !== undefined) {
    request.resolvedQuestionRequestIds = resolvedQuestionRequestIds;
  }
  if (systemPrompt !== undefined) request.systemPrompt = systemPrompt;
  if (submissionId !== undefined) request.submissionId = submissionId;
  return request;
};
