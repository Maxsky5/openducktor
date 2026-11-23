import { latestTurnUsageLimit } from "@openducktor/frontend-core/lib/agent-session-interrupted-turn";
import type { AgentChatInterruptedTurnResumeModel } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import type {
  AgentSessionIdentity,
  AgentSessionState,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import type { useWorkspaceSessionChatActions } from "./use-workspace-session-chat-actions";

/** The resume notice of a workspace chat, or undefined when the turn offers no Resume. */
export const buildWorkspaceInterruptedTurnResume = ({
  canResume,
  identity,
  session,
  actions,
}: {
  canResume: boolean;
  identity: AgentSessionIdentity | null;
  session: AgentSessionState | null;
  actions: Pick<
    ReturnType<typeof useWorkspaceSessionChatActions>,
    | "isResumingSession"
    | "resumeSessionError"
    | "resumeInterruptedTurn"
    | "cancelUsageLimitAutoResume"
  >;
}): AgentChatInterruptedTurnResumeModel | undefined => {
  if (!canResume || !identity) return undefined;
  const autoResume = session?.usageLimitAutoResume;
  return {
    isPending: actions.isResumingSession,
    isDisabled: false,
    error: actions.resumeSessionError,
    usageLimit: latestTurnUsageLimit(session?.messages.items ?? []),
    autoResume,
    onCancelAutoResume: (stopId) => actions.cancelUsageLimitAutoResume(identity, stopId),
    onResume: () => actions.resumeInterruptedTurn(identity),
  };
};
