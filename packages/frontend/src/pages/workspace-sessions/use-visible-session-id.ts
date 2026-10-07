import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import type { useWorkspaceSessionNavigation } from "./use-workspace-session-navigation";

export function useVisibleSessionId(
  requestedSelectedId: string | null,
  guardWorkspaceChange: ReturnType<typeof useWorkspacePreviewTransitionGuard>["run"],
  updateNavigation: ReturnType<typeof useWorkspaceSessionNavigation>["updateNavigation"],
  cancelPendingChange: ReturnType<typeof useWorkspacePreviewTransitionGuard>["cancelPending"],
  workspaceId: string,
) {
  const [visible, setVisible] = useState({ workspaceId, sessionId: requestedSelectedId });
  const visibleSelectedId =
    visible.workspaceId === workspaceId ? visible.sessionId : requestedSelectedId;
  const [retryCount, setRetryCount] = useState(0);
  const pendingRef = useRef<{ target: string | null } | null>(null);
  const canceledTargetRef = useRef<string | null | undefined>(undefined);
  if (visible.workspaceId !== workspaceId) {
    setVisible({ workspaceId, sessionId: requestedSelectedId });
  }
  useLayoutEffect(() => {
    pendingRef.current = null;
    canceledTargetRef.current = undefined;
  }, [workspaceId]);

  useEffect(() => {
    if (requestedSelectedId === visibleSelectedId) {
      canceledTargetRef.current = undefined;
      if (pendingRef.current) {
        pendingRef.current = null;
        cancelPendingChange();
      }
      return;
    }
    if (
      canceledTargetRef.current === requestedSelectedId ||
      pendingRef.current?.target === requestedSelectedId
    )
      return;
    const pending = { target: requestedSelectedId };
    pendingRef.current = pending;
    guardWorkspaceChange(
      () => {
        if (pendingRef.current !== pending) return;
        pendingRef.current = null;
        canceledTargetRef.current = undefined;
        setVisible({ workspaceId, sessionId: requestedSelectedId });
      },
      () => {
        if (pendingRef.current !== pending) return;
        pendingRef.current = null;
        canceledTargetRef.current = requestedSelectedId;
        updateNavigation({ sessionId: visibleSelectedId });
      },
    );
  }, [
    cancelPendingChange,
    guardWorkspaceChange,
    requestedSelectedId,
    retryCount,
    updateNavigation,
    visibleSelectedId,
    workspaceId,
  ]);

  const leaveRemovedChat = useCallback(() => {
    if (
      requestedSelectedId !== null ||
      visibleSelectedId === null ||
      canceledTargetRef.current !== null
    )
      return;
    canceledTargetRef.current = undefined;
    setRetryCount((count) => count + 1);
  }, [requestedSelectedId, visibleSelectedId]);
  const completeArchive = useCallback(
    (sessionId: string | null) => {
      pendingRef.current = null;
      canceledTargetRef.current = undefined;
      setVisible({ workspaceId, sessionId });
      updateNavigation({ sessionId });
    },
    [updateNavigation, workspaceId],
  );
  return { visibleSelectedId, leaveRemovedChat, completeArchive };
}
