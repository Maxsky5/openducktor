import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentApprovalRequest, AgentSessionIdentity } from "@/types/agent-orchestrator";

type UseAgentSessionApprovalActionsParams = {
  sessionIdentity: AgentSessionIdentity | null;
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
  sessionIdentity,
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
  const sessionKey = sessionIdentity ? agentSessionIdentityKey(sessionIdentity) : null;
  const [resetInputs, setResetInputs] = useState({
    sessionKey,
    pendingApprovalRequestIdsKey,
  });

  if (
    resetInputs.sessionKey !== sessionKey ||
    resetInputs.pendingApprovalRequestIdsKey !== pendingApprovalRequestIdsKey
  ) {
    const sessionChanged = resetInputs.sessionKey !== sessionKey;
    setResetInputs({ sessionKey, pendingApprovalRequestIdsKey });

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
      if (!sessionIdentity || !agentStudioReady) {
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
        await replyAgentApproval(sessionIdentity, requestId, outcome);
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
    [agentStudioReady, replyAgentApproval, sessionIdentity],
  );

  return {
    isSubmittingApprovalByRequestId,
    approvalReplyErrorByRequestId,
    onReplyApproval,
  };
}
