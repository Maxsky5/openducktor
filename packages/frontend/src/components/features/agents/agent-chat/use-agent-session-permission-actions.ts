import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentPermissionRequest } from "@/types/agent-orchestrator";

type PermissionReply = "once" | "always" | "reject";

type UseAgentSessionPermissionActionsParams = {
  activeExternalSessionId: string | null;
  pendingPermissions: AgentPermissionRequest[];
  agentStudioReady: boolean;
  replyAgentPermission: (
    externalSessionId: string,
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
  activeExternalSessionId,
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
  const previousSessionIdRef = useRef<string | null>(activeExternalSessionId);

  useEffect(() => {
    if (previousSessionIdRef.current === activeExternalSessionId) {
      return;
    }
    previousSessionIdRef.current = activeExternalSessionId;
    setIsSubmittingPermissionByRequestId({});
    setPermissionReplyErrorByRequestId({});
  }, [activeExternalSessionId]);

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
      if (!activeExternalSessionId || !agentStudioReady) {
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
        await replyAgentPermission(activeExternalSessionId, requestId, reply);
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
    [activeExternalSessionId, agentStudioReady, replyAgentPermission],
  );

  return {
    isSubmittingPermissionByRequestId,
    permissionReplyErrorByRequestId,
    onReplyPermission,
  };
}
