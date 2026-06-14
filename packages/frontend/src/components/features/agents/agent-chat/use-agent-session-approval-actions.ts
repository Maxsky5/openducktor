import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentApprovalRequest, AgentSessionIdentity } from "@/types/agent-orchestrator";

type UseAgentSessionApprovalActionsParams = {
  activeSession: AgentSessionIdentity | null;
  pendingApprovals: readonly AgentApprovalRequest[];
  agentStudioReady: boolean;
  replyAgentApproval: (
    session: AgentSessionIdentity,
    requestId: string,
    outcome: RuntimeApprovalReplyOutcome,
  ) => Promise<void>;
};

const filterBooleanMapByPendingRequestIds = (
  source: Record<string, boolean>,
  pendingRequestIds: Set<string>,
): Record<string, boolean> => {
  let changed = false;
  const next: Record<string, boolean> = {};
  for (const [requestId, value] of Object.entries(source)) {
    if (!pendingRequestIds.has(requestId)) {
      changed = true;
      continue;
    }
    next[requestId] = value;
  }
  return changed ? next : source;
};

const filterStringMapByPendingRequestIds = (
  source: Record<string, string>,
  pendingRequestIds: Set<string>,
): Record<string, string> => {
  let changed = false;
  const next: Record<string, string> = {};
  for (const [requestId, value] of Object.entries(source)) {
    if (!pendingRequestIds.has(requestId)) {
      changed = true;
      continue;
    }
    next[requestId] = value;
  }
  return changed ? next : source;
};

export function useAgentSessionApprovalActions({
  activeSession,
  pendingApprovals,
  agentStudioReady,
  replyAgentApproval,
}: UseAgentSessionApprovalActionsParams): {
  isSubmittingApprovalByRequestId: Record<string, boolean>;
  approvalReplyErrorByRequestId: Record<string, string>;
  onReplyApproval: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
} {
  const [isSubmittingApprovalByRequestId, setIsSubmittingApprovalByRequestId] = useState<
    Record<string, boolean>
  >({});
  const [approvalReplyErrorByRequestId, setApprovalReplyErrorByRequestId] = useState<
    Record<string, string>
  >({});
  const pendingApprovalRequestIdsKey = useMemo(
    () => JSON.stringify(pendingApprovals.map((request) => request.requestId)),
    [pendingApprovals],
  );
  const activeSessionKey = activeSession ? agentSessionIdentityKey(activeSession) : null;
  const [resetInputs, setResetInputs] = useState({
    activeSessionKey,
    pendingApprovalRequestIdsKey,
  });

  if (
    resetInputs.activeSessionKey !== activeSessionKey ||
    resetInputs.pendingApprovalRequestIdsKey !== pendingApprovalRequestIdsKey
  ) {
    const sessionChanged = resetInputs.activeSessionKey !== activeSessionKey;
    setResetInputs({ activeSessionKey, pendingApprovalRequestIdsKey });

    if (sessionChanged) {
      setIsSubmittingApprovalByRequestId({});
      setApprovalReplyErrorByRequestId({});
    } else {
      const pendingRequestIds = new Set(pendingApprovals.map((request) => request.requestId));
      setIsSubmittingApprovalByRequestId((current) =>
        filterBooleanMapByPendingRequestIds(current, pendingRequestIds),
      );
      setApprovalReplyErrorByRequestId((current) =>
        filterStringMapByPendingRequestIds(current, pendingRequestIds),
      );
    }
  }

  const onReplyApproval = useCallback(
    async (requestId: string, outcome: RuntimeApprovalReplyOutcome): Promise<void> => {
      if (!activeSession || !agentStudioReady) {
        return;
      }

      setIsSubmittingApprovalByRequestId((current) => ({
        ...current,
        [requestId]: true,
      }));
      setApprovalReplyErrorByRequestId((current) => {
        if (!current[requestId]) {
          return current;
        }
        const next = { ...current };
        delete next[requestId];
        return next;
      });

      try {
        await replyAgentApproval(activeSession, requestId, outcome);
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to reply to approval request.";
        setApprovalReplyErrorByRequestId((current) => ({
          ...current,
          [requestId]: message,
        }));
      } finally {
        setIsSubmittingApprovalByRequestId((current) => {
          if (!current[requestId]) {
            return current;
          }
          const next = { ...current };
          delete next[requestId];
          return next;
        });
      }
    },
    [activeSession, agentStudioReady, replyAgentApproval],
  );

  return {
    isSubmittingApprovalByRequestId,
    approvalReplyErrorByRequestId,
    onReplyApproval,
  };
}
