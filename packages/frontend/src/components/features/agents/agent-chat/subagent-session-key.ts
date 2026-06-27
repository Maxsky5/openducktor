import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentChatMessage, AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";

export type ParentSessionRuntimeIdentity = Pick<
  AgentSessionTranscriptTarget,
  "runtimeKind" | "workingDirectory" | "taskId" | "role"
>;

export const toSubagentSessionIdentity = ({
  externalSessionId,
  parentSession,
}: {
  externalSessionId: string | null | undefined;
  parentSession: ParentSessionRuntimeIdentity | null | undefined;
}): AgentSessionIdentity | null => {
  const resolvedExternalSessionId = externalSessionId?.trim();
  const workingDirectory = parentSession?.workingDirectory.trim();
  if (!resolvedExternalSessionId || !parentSession || !workingDirectory) {
    return null;
  }

  return toAgentSessionIdentity({
    externalSessionId: resolvedExternalSessionId,
    runtimeKind: parentSession.runtimeKind,
    workingDirectory,
  });
};

export const toSubagentTranscriptTarget = ({
  externalSessionId,
  parentSession,
}: {
  externalSessionId: string | null | undefined;
  parentSession: ParentSessionRuntimeIdentity | null | undefined;
}): AgentSessionTranscriptTarget | null => {
  const identity = toSubagentSessionIdentity({ externalSessionId, parentSession });
  if (!identity || !parentSession) {
    return null;
  }

  return {
    ...identity,
    taskId: parentSession.taskId,
    role: parentSession.role,
  };
};

export const getSubagentMessageSessionIdentity = ({
  message,
  parentSession,
}: {
  message: AgentChatMessage;
  parentSession: ParentSessionRuntimeIdentity | null | undefined;
}): AgentSessionIdentity | null => {
  if (message.meta?.kind !== "subagent") {
    return null;
  }

  return toSubagentSessionIdentity({
    externalSessionId: message.meta.externalSessionId,
    parentSession,
  });
};

export const getSubagentMessageSessionKey = ({
  message,
  parentSession,
}: {
  message: AgentChatMessage;
  parentSession: ParentSessionRuntimeIdentity | null | undefined;
}): string | null => {
  const subagentIdentity = getSubagentMessageSessionIdentity({ message, parentSession });
  return subagentIdentity ? agentSessionIdentityKey(subagentIdentity) : null;
};
