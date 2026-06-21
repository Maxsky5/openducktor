import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { useCallback, useMemo, useRef, useState } from "react";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentApprovalRequest, AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  type AgentSessionRequestState,
  removeAgentSessionRequestValue,
  selectPendingAgentSessionRequestValues,
  setAgentSessionRequestValue,
} from "./agent-session-request-state";

type UseAgentSessionApprovalActionsParams = {
  sessionIdentity: AgentSessionIdentity | null;
  pendingApprovals: readonly AgentApprovalRequest[];
  canReplyToApprovals: boolean;
  replyAgentApproval: (
    session: AgentSessionIdentity,
    request: AgentApprovalRequest,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ) => Promise<void>;
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
    AgentSessionRequestState<boolean>
  >({});
  const [approvalReplyErrorBySessionKey, setApprovalReplyErrorBySessionKey] = useState<
    AgentSessionRequestState<string>
  >({});
  const sessionExternalSessionId = sessionIdentity?.externalSessionId ?? null;
  const sessionRuntimeKind = sessionIdentity?.runtimeKind ?? null;
  const sessionWorkingDirectory = sessionIdentity?.workingDirectory ?? null;
  const sessionKey = sessionIdentity ? agentSessionIdentityKey(sessionIdentity) : null;
  const pendingApprovalRequestIds = useMemo(
    () => pendingApprovals.map((request) => request.requestId),
    [pendingApprovals],
  );
  const pendingApprovalByRequestId = useMemo(
    () => new Map(pendingApprovals.map((request) => [request.requestId, request])),
    [pendingApprovals],
  );
  const pendingApprovalByRequestIdRef = useRef(pendingApprovalByRequestId);
  pendingApprovalByRequestIdRef.current = pendingApprovalByRequestId;

  const isSubmittingApprovalByRequestId = useMemo(() => {
    if (!sessionKey) {
      return {};
    }
    return selectPendingAgentSessionRequestValues(
      submittingApprovalBySessionKey,
      sessionKey,
      pendingApprovalRequestIds,
    );
  }, [pendingApprovalRequestIds, sessionKey, submittingApprovalBySessionKey]);

  const approvalReplyErrorByRequestId = useMemo(() => {
    if (!sessionKey) {
      return {};
    }
    return selectPendingAgentSessionRequestValues(
      approvalReplyErrorBySessionKey,
      sessionKey,
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
      const request = pendingApprovalByRequestIdRef.current.get(requestId);
      if (!request) {
        return;
      }

      setSubmittingApprovalBySessionKey((current) =>
        setAgentSessionRequestValue(current, sessionKey, requestId, true),
      );
      setApprovalReplyErrorBySessionKey((current) =>
        removeAgentSessionRequestValue(current, sessionKey, requestId),
      );

      try {
        await replyAgentApproval(sessionActionTarget, request, outcome, undefined);
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to reply to approval request.";
        setApprovalReplyErrorBySessionKey((current) =>
          setAgentSessionRequestValue(current, sessionKey, requestId, message),
        );
      } finally {
        setSubmittingApprovalBySessionKey((current) =>
          removeAgentSessionRequestValue(current, sessionKey, requestId),
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
