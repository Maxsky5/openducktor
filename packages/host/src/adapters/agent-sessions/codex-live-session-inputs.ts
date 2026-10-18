import type {
  AgentSessionControlSendInput,
  AgentSessionScope,
  AgentSessionUserMessagePart,
} from "@openducktor/contracts";
import type { AgentRuntimePolicyBinding, AgentUserMessagePart } from "@openducktor/core";
import type { CodexSessionController } from "./codex-live-session-adapter-contract";

type CodexSendRequest = Parameters<CodexSessionController["sendUserMessage"]>[0];

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
    parts: parts.map(toCodexUserMessagePart),
  };
  if (resolvedQuestionRequestIds !== undefined) {
    request.resolvedQuestionRequestIds = resolvedQuestionRequestIds;
  }
  if (systemPrompt !== undefined) request.systemPrompt = systemPrompt;
  if (submissionId !== undefined) request.submissionId = submissionId;
  return request;
};

const toCodexUserMessagePart = (part: AgentSessionUserMessagePart): AgentUserMessagePart => {
  if (part.kind !== "attachment") {
    return part;
  }
  const { mime, ...requiredAttachment } = part.attachment;
  if (mime === undefined) {
    return { kind: "attachment", attachment: requiredAttachment };
  }
  return {
    kind: "attachment",
    attachment: { ...requiredAttachment, mime },
  };
};
