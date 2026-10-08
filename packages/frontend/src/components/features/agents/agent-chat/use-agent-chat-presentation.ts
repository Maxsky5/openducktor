import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentSkillReference } from "@openducktor/core";
import { useMemo } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { RuntimeReadiness } from "@/lib/use-runtime-readiness";
import { resolveAgentPendingInputParticipants } from "@/state/agent-session-pending-input-participants";
import type { AgentSessionPendingInputSummary } from "@/state/agent-session-snapshots";
import { useAgentActivitySnapshot } from "@/state/app-state-provider";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
} from "@/types/agent-orchestrator";
import { resolveAgentSessionAccentColor } from "../agent-accent-color";
import type {
  AgentChatTranscriptNoticeAction,
  AgentChatTranscriptSession,
} from "./agent-chat.types";
import { withClaudeSkillMentions } from "./claude-skill-mentions";

const EMPTY_PENDING_COUNTS: Record<string, number> = Object.freeze({});
type PendingInputRequest = AgentApprovalRequest | AgentQuestionRequest;

type UseAgentChatPresentationArgs = {
  session: AgentChatTranscriptSession | null;
  sessionIdentity: AgentSessionIdentity | null;
  pendingApprovals: readonly AgentApprovalRequest[];
  pendingQuestions: readonly AgentQuestionRequest[];
  skills: readonly AgentSkillReference[];
  profileId: string | undefined;
  runtimeKind: RuntimeKind | null;
  sessionAgentColors: Record<string, string>;
  runtimeReadiness: Pick<RuntimeReadiness, "isLoadingChecks" | "refreshChecks">;
};

type ChatPresentation = {
  transcriptSession: AgentChatTranscriptSession | null;
  sessionAccentColor: string | undefined;
  runtimeBlockedAction: AgentChatTranscriptNoticeAction;
  subagentPendingApprovalCountBySessionKey: Record<string, number>;
  subagentPendingQuestionCountBySessionKey: Record<string, number>;
};

export function useAgentChatPresentation({
  session,
  sessionIdentity,
  pendingApprovals,
  pendingQuestions,
  skills,
  profileId,
  runtimeKind,
  sessionAgentColors,
  runtimeReadiness: { isLoadingChecks, refreshChecks },
}: UseAgentChatPresentationArgs): ChatPresentation {
  const { pendingInputSessions: sessions } = useAgentActivitySnapshot();
  const transcriptSession = useMemo(
    () =>
      session ? { ...withClaudeSkillMentions(session, skills), skillReferences: skills } : null,
    [session, skills],
  );
  const sessionAccentColor = resolveAgentSessionAccentColor({
    agentName: profileId,
    agentColors: sessionAgentColors,
    runtimeKind,
  });
  const runtimeBlockedAction = useMemo(
    () => ({
      label: "Recheck",
      onAction: () => void refreshChecks(),
      disabled: isLoadingChecks,
      isPending: isLoadingChecks,
    }),
    [isLoadingChecks, refreshChecks],
  );
  const subagentPendingApprovalCountBySessionKey = useMemo(
    () =>
      countPendingInput(
        sessions,
        (summary) => summary.pendingApprovalCount,
        sessionIdentity,
        pendingApprovals,
      ),
    [sessions, sessionIdentity, pendingApprovals],
  );
  const subagentPendingQuestionCountBySessionKey = useMemo(
    () =>
      countPendingInput(
        sessions,
        (summary) => summary.pendingQuestionCount,
        sessionIdentity,
        pendingQuestions,
      ),
    [sessions, sessionIdentity, pendingQuestions],
  );
  return {
    transcriptSession,
    sessionAccentColor,
    runtimeBlockedAction,
    subagentPendingApprovalCountBySessionKey,
    subagentPendingQuestionCountBySessionKey,
  };
}

const countPendingInput = (
  sessions: readonly AgentSessionPendingInputSummary[],
  readCount: (session: AgentSessionPendingInputSummary) => number,
  sessionIdentity: AgentSessionIdentity | null,
  requests: readonly PendingInputRequest[],
): Record<string, number> => {
  const counts: Record<string, number> = {};
  const keepLargerCount = (key: string, count: number): void => {
    counts[key] = Math.max(counts[key] ?? 0, count);
  };
  for (const session of sessions) {
    const count = readCount(session);
    if (count > 0) {
      keepLargerCount(agentSessionIdentityKey(session), count);
    }
  }

  const requestCounts = new Map<string, number>();
  for (const request of requests) {
    const childSession = getChildSession(sessionIdentity, request);
    if (!childSession) {
      continue;
    }
    const sessionKey = agentSessionIdentityKey(childSession);
    const count = requestCounts.get(sessionKey) ?? 0;
    requestCounts.set(sessionKey, count + 1);
  }
  // Parent requests can mirror child requests, so keep the larger count instead of adding them.
  for (const [sessionKey, count] of requestCounts) {
    keepLargerCount(sessionKey, count);
  }
  return Object.keys(counts).length > 0 ? counts : EMPTY_PENDING_COUNTS;
};

const getChildSession = (
  sessionIdentity: AgentSessionIdentity | null,
  request: PendingInputRequest,
): AgentSessionIdentity | null => {
  if (request.source?.kind !== "subagent") {
    return null;
  }
  if (request.responseSession) {
    return request.responseSession;
  }
  if (!sessionIdentity) {
    return null;
  }
  return resolveAgentPendingInputParticipants(sessionIdentity, request).subagentChildSession;
};
