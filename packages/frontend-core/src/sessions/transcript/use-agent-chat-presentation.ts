import type { AgentSkillReference } from "@openducktor/core";
import { useMemo } from "react";
import type { RuntimeReadiness } from "../../lib/use-runtime-readiness";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
} from "../../types/agent-orchestrator";
import type { AgentChatTranscriptNoticeAction } from "../send/agent-chat.types";
import type { AgentChatTranscriptSession } from "./agent-chat-transcript.types";
import { withClaudeSkillMentions } from "./claude-skill-mentions";
import { useSubagentPendingInputCounts } from "./subagent-pending-input-counts";

type UseAgentChatPresentationArgs = {
  session: AgentChatTranscriptSession | null;
  sessionIdentity: AgentSessionIdentity | null;
  pendingApprovals: readonly AgentApprovalRequest[];
  pendingQuestions: readonly AgentQuestionRequest[];
  skills: readonly AgentSkillReference[];
  runtimeReadiness: Pick<RuntimeReadiness, "isLoadingChecks" | "refreshChecks">;
};

type ChatPresentation = {
  transcriptSession: AgentChatTranscriptSession | null;
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
  runtimeReadiness: { isLoadingChecks, refreshChecks },
}: UseAgentChatPresentationArgs): ChatPresentation {
  const transcriptSession = useMemo(
    () =>
      session ? { ...withClaudeSkillMentions(session, skills), skillReferences: skills } : null,
    [session, skills],
  );
  const runtimeBlockedAction = useMemo(
    () => ({
      label: "Recheck",
      onAction: () => void refreshChecks(),
      disabled: isLoadingChecks,
      isPending: isLoadingChecks,
    }),
    [isLoadingChecks, refreshChecks],
  );
  const pendingCounts = useSubagentPendingInputCounts({
    sessionIdentity,
    pendingApprovals,
    pendingQuestions,
  });
  return {
    transcriptSession,
    runtimeBlockedAction,
    subagentPendingApprovalCountBySessionKey: pendingCounts.approvals,
    subagentPendingQuestionCountBySessionKey: pendingCounts.questions,
  };
}
