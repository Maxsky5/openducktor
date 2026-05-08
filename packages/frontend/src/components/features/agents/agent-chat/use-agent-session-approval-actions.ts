import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentApprovalRequest } from "@/types/agent-orchestrator";

type UseAgentSessionApprovalActionsParams = {
  activeExternalSessionId: string | null;
  pendingApprovals: ReadonlyArray<AgentApprovalRequest>;
  agentStudioReady: boolean;
  replyAgentApproval: (
    externalSessionId: string,
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
  activeExternalSessionId,
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
  const previousSessionIdRef = useRef<string | null>(activeExternalSessionId);

  useEffect(() => {
    if (previousSessionIdRef.current === activeExternalSessionId) {
      return;
    }
    previousSessionIdRef.current = activeExternalSessionId;
    setIsSubmittingApprovalByRequestId({});
    setApprovalReplyErrorByRequestId({});
  }, [activeExternalSessionId]);

  useEffect(() => {
    const pendingRequestIds = new Set(pendingApprovals.map((request) => request.requestId));
    setIsSubmittingApprovalByRequestId((current) =>
      filterBooleanMapByPendingRequestIds(current, pendingRequestIds),
    );
    setApprovalReplyErrorByRequestId((current) =>
      filterStringMapByPendingRequestIds(current, pendingRequestIds),
    );
  }, [pendingApprovals]);

  const onReplyApproval = useCallback(
    async (requestId: string, outcome: RuntimeApprovalReplyOutcome): Promise<void> => {
      if (!activeExternalSessionId || !agentStudioReady) {
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
        await replyAgentApproval(activeExternalSessionId, requestId, outcome);
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
    [activeExternalSessionId, agentStudioReady, replyAgentApproval],
  );

  return {
    isSubmittingApprovalByRequestId,
    approvalReplyErrorByRequestId,
    onReplyApproval,
  };
}
