import type { AgentPermissionRequest } from "@/types/agent-orchestrator";
import { useCallback, useEffect, useRef, useState } from "react";

type PermissionReply = "once" | "always" | "reject";

type UseAgentSessionPermissionActionsParams = {
  activeSessionId: string | null;
  pendingPermissions: AgentPermissionRequest[];
  agentStudioReady: boolean;
  replyAgentPermission: (
    sessionId: string,
    requestId: string,
    reply: PermissionReply,
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

export function useAgentSessionPermissionActions({
  activeSessionId,
  pendingPermissions,
  agentStudioReady,
  replyAgentPermission,
}: UseAgentSessionPermissionActionsParams): {
  isSubmittingPermissionByRequestId: Record<string, boolean>;
  permissionReplyErrorByRequestId: Record<string, string>;
  onReplyPermission: (requestId: string, reply: PermissionReply) => Promise<void>;
} {
  const [isSubmittingPermissionByRequestId, setIsSubmittingPermissionByRequestId] = useState<
    Record<string, boolean>
  >({});
  const [permissionReplyErrorByRequestId, setPermissionReplyErrorByRequestId] = useState<
    Record<string, string>
  >({});
  const previousSessionIdRef = useRef<string | null>(activeSessionId);

  useEffect(() => {
    if (previousSessionIdRef.current === activeSessionId) {
      return;
    }
    previousSessionIdRef.current = activeSessionId;
    setIsSubmittingPermissionByRequestId({});
    setPermissionReplyErrorByRequestId({});
  }, [activeSessionId]);

  useEffect(() => {
    const pendingRequestIds = new Set(pendingPermissions.map((request) => request.requestId));
    setIsSubmittingPermissionByRequestId((current) =>
      filterBooleanMapByPendingRequestIds(current, pendingRequestIds),
    );
    setPermissionReplyErrorByRequestId((current) =>
      filterStringMapByPendingRequestIds(current, pendingRequestIds),
    );
  }, [pendingPermissions]);

  const onReplyPermission = useCallback(
    async (requestId: string, reply: PermissionReply): Promise<void> => {
      if (!activeSessionId || !agentStudioReady) {
        return;
      }

      setIsSubmittingPermissionByRequestId((current) => ({
        ...current,
        [requestId]: true,
      }));
      setPermissionReplyErrorByRequestId((current) => {
        if (!current[requestId]) {
          return current;
        }
        const next = { ...current };
        delete next[requestId];
        return next;
      });

      try {
        await replyAgentPermission(activeSessionId, requestId, reply);
      } catch (error) {
        const message =
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "Failed to reply to permission request.";
        setPermissionReplyErrorByRequestId((current) => ({
          ...current,
          [requestId]: message,
        }));
      } finally {
        setIsSubmittingPermissionByRequestId((current) => {
          if (!current[requestId]) {
            return current;
          }
          const next = { ...current };
          delete next[requestId];
          return next;
        });
      }
    },
    [activeSessionId, agentStudioReady, replyAgentPermission],
  );

  return {
    isSubmittingPermissionByRequestId,
    permissionReplyErrorByRequestId,
    onReplyPermission,
  };
}
