import { useEffect, useRef, useState } from "react";
import type { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import type { useWorkspaceSessionNavigation } from "./use-workspace-session-navigation";

export function useVisibleSessionId(
  requestedSelectedId: string | null,
  guardWorkspaceChange: ReturnType<typeof useWorkspacePreviewTransitionGuard>["run"],
  updateNavigation: ReturnType<typeof useWorkspaceSessionNavigation>["updateNavigation"],
): string | null {
  const [visibleSelectedId, setVisibleSelectedId] = useState<string | null>(requestedSelectedId);
  const pendingRef = useRef<{ target: string | null } | null>(null);

  useEffect(() => {
    if (requestedSelectedId === visibleSelectedId) {
      pendingRef.current = null;
      return;
    }
    if (pendingRef.current?.target === requestedSelectedId) return;
    const pending = { target: requestedSelectedId };
    pendingRef.current = pending;
    guardWorkspaceChange(
      () => {
        if (pendingRef.current !== pending) return;
        pendingRef.current = null;
        setVisibleSelectedId(requestedSelectedId);
      },
      () => {
        if (pendingRef.current !== pending) return;
        pendingRef.current = null;
        updateNavigation({ sessionId: visibleSelectedId });
      },
    );
  }, [guardWorkspaceChange, requestedSelectedId, updateNavigation, visibleSelectedId]);

  return visibleSelectedId;
}
