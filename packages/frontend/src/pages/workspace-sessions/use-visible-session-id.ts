import { useCallback, useEffect, useRef, useState } from "react";
import type { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import type { useWorkspaceSessionNavigation } from "./use-workspace-session-navigation";

export function useVisibleSessionId(
  requestedSelectedId: string | null,
  guardWorkspaceChange: ReturnType<typeof useWorkspacePreviewTransitionGuard>["run"],
  updateNavigation: ReturnType<typeof useWorkspaceSessionNavigation>["updateNavigation"],
  cancelPendingChange: ReturnType<typeof useWorkspacePreviewTransitionGuard>["cancelPending"],
) {
  const [visibleSelectedId, setVisibleSelectedId] = useState<string | null>(requestedSelectedId);
  const [retryCount, setRetryCount] = useState(0);
  const pendingRef = useRef<{ target: string | null } | null>(null);
  const canceledTargetRef = useRef<string | null | undefined>(undefined);

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
        setVisibleSelectedId(requestedSelectedId);
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
  ]);

  const selectTab = useCallback(
    (sessionId: string) => {
      if (sessionId === requestedSelectedId && sessionId !== visibleSelectedId) {
        canceledTargetRef.current = undefined;
        setRetryCount((count) => count + 1);
      } else {
        updateNavigation({ sessionId }, false);
      }
    },
    [requestedSelectedId, updateNavigation, visibleSelectedId],
  );
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
  return { visibleSelectedId, selectTab, leaveRemovedChat };
}
