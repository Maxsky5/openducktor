import {
  HANDOFF_ATTEMPT_MISSING,
  type AgentChatHandoffResult,
  type AgentChatRef,
} from "@openducktor/contracts";
import { HostInvokeError } from "@openducktor/host-client";
import type { AgentSessionsStore } from "../sessions/agent-sessions-store";

export const chat = {
  kind: "workspace_session",
  workspaceId: "workspace",
  repoPath: "/repo",
  sessionId: "chat",
} satisfies AgentChatRef;
export const source = {
  runtimeKind: "opencode",
  externalSessionId: "one",
  workingDirectory: "/repo",
} as const;
export const target = { ...source, runtimeKind: "codex", externalSessionId: "two" } as const;
export const destination = {
  runtimeKind: "codex",
  providerId: "openai",
  modelId: "gpt-5.5",
} as const;
export const acceptedLink = {
  from: source,
  to: target,
  partialHistory: false,
  firstMessageId: "turn",
};
export const parts = [{ kind: "text", text: "Continue the review." }] as const;

export const outcome = (
  submissionId: string,
  status: "uncertain" | "accepted" | "committed",
): AgentChatHandoffResult => {
  const result: AgentChatHandoffResult = {
    ref: { ...source, repoPath: chat.repoPath },
    submissionId,
    kind: "handoff",
    pending: false,
    nativeOutcome: status === "committed" ? "accepted" : status,
    handoff: { chat, destination, expectedActive: source },
  };
  if (status !== "uncertain") result.handoff.acceptedLink = acceptedLink;
  if (status === "committed") result.handoff.committed = true;
  return result;
};

export const missing = (submissionId: string) =>
  new HostInvokeError("No delivery record for this submission yet", {
    kind: "session_operation",
    observation: {
      ref: { ...source, repoPath: chat.repoPath },
      kind: "handoff",
      submissionId,
      pending: false,
      nativeOutcome: "uncertain",
      failure: {
        stage: "check",
        code: HANDOFF_ATTEMPT_MISSING,
        message: "No delivery record for this submission yet",
        nextAction: "Keep the draft and check delivery again.",
      },
    },
  });

export const attach = (
  sessions: AgentSessionsStore,
  hostEpoch: string,
  sessionOperations: AgentChatHandoffResult[] = [],
) => {
  sessions.applyLiveSessionEnvelope({
    type: "snapshot",
    isConnectionSnapshot: true,
    hostEpoch,
    repoPath: chat.repoPath,
    sessions: [],
    messageQueues: [],
    sessionOperations,
  });
  sessions.setSessionCollection((current) => current);
};
