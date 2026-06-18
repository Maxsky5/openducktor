import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentApprovalRequest, AgentSessionIdentity } from "@/types/agent-orchestrator";

type UseAgentSessionApprovalActionsParams = {
  sessionIdentity: AgentSessionIdentity | null;
  pendingApprovals: readonly AgentApprovalRequest[];
  canReplyToApprovals: boolean;
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

const setSessionRequestValue = <Value>(
  source: Record<string, Record<string, Value>>,
  sessionKey: string,
  requestId: string,
  value: Value,
): Record<string, Record<string, Value>> => ({
  ...source,
  [sessionKey]: {
    ...(source[sessionKey] ?? {}),
    [requestId]: value,
  },
});

const removeSessionRequestValue = <Value>(
  source: Record<string, Record<string, Value>>,
  sessionKey: string,
  requestId: string,
): Record<string, Record<string, Value>> => {
  const sessionRequests = source[sessionKey];
  if (!sessionRequests || !(requestId in sessionRequests)) {
    return source;
  }

  const nextSessionRequests = { ...sessionRequests };
  delete nextSessionRequests[requestId];
  const next = { ...source };
  if (Object.keys(nextSessionRequests).length === 0) {
    delete next[sessionKey];
  } else {
    next[sessionKey] = nextSessionRequests;
  }
  return next;
};

export function useAgentSessionApprovalActions({
  sessionIdentity,
  pendingApprovals,
  canReplyToApprovals,
  replyAgentApproval,
}: UseAgentSessionApprovalActionsParams): {
  isSubmittingApprovalByRequestId: Record<string, boolean>;
  approvalReplyErrorByRequestId: Record<string, string>;
  onReplyApproval: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
} {
  const [submittingApprovalBySessionKey, setSubmittingApprovalBySessionKey] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [approvalReplyErrorBySessionKey, setApprovalReplyErrorBySessionKey] = useState<
    Record<string, Record<string, string>>
  >({});
  const sessionExternalSessionId = sessionIdentity?.externalSessionId ?? null;
  const sessionRuntimeKind = sessionIdentity?.runtimeKind ?? null;
  const sessionWorkingDirectory = sessionIdentity?.workingDirectory ?? null;
  const sessionKey = sessionIdentity ? agentSessionIdentityKey(sessionIdentity) : null;
  const pendingApprovalRequestIds = useMemo(
    () => new Set(pendingApprovals.map((request) => request.requestId)),
    [pendingApprovals],
  );

  const isSubmittingApprovalByRequestId = useMemo(() => {
    if (!sessionKey) {
      return {};
    }
    return filterBooleanMapByPendingRequestIds(
      submittingApprovalBySessionKey[sessionKey] ?? {},
      pendingApprovalRequestIds,
    );
  }, [pendingApprovalRequestIds, sessionKey, submittingApprovalBySessionKey]);

  const approvalReplyErrorByRequestId = useMemo(() => {
    if (!sessionKey) {
      return {};
    }
    return filterStringMapByPendingRequestIds(
      approvalReplyErrorBySessionKey[sessionKey] ?? {},
      pendingApprovalRequestIds,
    );
  }, [approvalReplyErrorBySessionKey, pendingApprovalRequestIds, sessionKey]);

  const onReplyApproval = useCallback(
    async (requestId: string, outcome: RuntimeApprovalReplyOutcome): Promise<void> => {
      if (
        !sessionKey ||
        sessionExternalSessionId === null ||
        sessionRuntimeKind === null ||
        sessionWorkingDirectory === null ||
        !canReplyToApprovals
      ) {
        return;
      }
      const sessionActionTarget = toAgentSessionIdentity({
        externalSessionId: sessionExternalSessionId,
        runtimeKind: sessionRuntimeKind,
        workingDirectory: sessionWorkingDirectory,
      });

      setSubmittingApprovalBySessionKey((current) =>
        setSessionRequestValue(current, sessionKey, requestId, true),
      );
      setApprovalReplyErrorBySessionKey((current) =>
        removeSessionRequestValue(current, sessionKey, requestId),
      );

      try {
        await replyAgentApproval(sessionActionTarget, requestId, outcome);
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to reply to approval request.";
        setApprovalReplyErrorBySessionKey((current) =>
          setSessionRequestValue(current, sessionKey, requestId, message),
        );
      } finally {
        setSubmittingApprovalBySessionKey((current) =>
          removeSessionRequestValue(current, sessionKey, requestId),
        );
      }
    },
    [
      canReplyToApprovals,
      replyAgentApproval,
      sessionExternalSessionId,
      sessionKey,
      sessionRuntimeKind,
      sessionWorkingDirectory,
    ],
  );

  return {
    isSubmittingApprovalByRequestId,
    approvalReplyErrorByRequestId,
    onReplyApproval,
  };
}
