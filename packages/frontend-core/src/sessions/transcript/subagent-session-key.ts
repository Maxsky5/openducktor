import { agentSessionIdentityKey, toAgentSessionIdentity } from "../../lib/agent-session-identity";
import type { AgentChatMessage, AgentSessionIdentity } from "../../types/agent-orchestrator";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";

export type ParentSessionRuntimeContext = Pick<
  AgentSessionTranscriptTarget,
  "runtimeKind" | "workingDirectory" | "sessionScope"
>;

type SubagentSessionReference = {
  externalSessionId?: string | null | undefined;
  parentSession: ParentSessionRuntimeContext | null | undefined;
  sourceSession?: ParentSessionRuntimeContext | undefined;
};

export const toSubagentSessionIdentity = ({
  externalSessionId,
  parentSession,
  sourceSession,
}: SubagentSessionReference): AgentSessionIdentity | null => {
  const session = sourceSession ?? parentSession;
  const resolvedExternalSessionId = externalSessionId?.trim();
  const workingDirectory = session?.workingDirectory.trim();
  if (!resolvedExternalSessionId || !session || !workingDirectory) {
    return null;
  }

  return toAgentSessionIdentity({
    externalSessionId: resolvedExternalSessionId,
    runtimeKind: session.runtimeKind,
    workingDirectory,
  });
};

export const toSubagentTranscriptTarget = (
  reference: SubagentSessionReference,
): AgentSessionTranscriptTarget | null => {
  const identity = toSubagentSessionIdentity(reference);
  if (!identity) return null;
  const sessionScope = (reference.sourceSession ?? reference.parentSession)?.sessionScope;
  return sessionScope ? { ...identity, sessionScope } : identity;
};

const getSubagentMessageSessionIdentity = ({
  message,
  parentSession,
}: {
  message: AgentChatMessage;
  parentSession: ParentSessionRuntimeContext | null | undefined;
}): AgentSessionIdentity | null => {
  if (message.meta?.kind !== "subagent") {
    return null;
  }

  return toSubagentSessionIdentity({
    ...message.meta,
    parentSession,
  });
};

export const getSubagentMessageSessionKey = ({
  message,
  parentSession,
}: {
  message: AgentChatMessage;
  parentSession: ParentSessionRuntimeContext | null | undefined;
}): string | null => {
  const subagentIdentity = getSubagentMessageSessionIdentity({ message, parentSession });
  return subagentIdentity ? agentSessionIdentityKey(subagentIdentity) : null;
};
