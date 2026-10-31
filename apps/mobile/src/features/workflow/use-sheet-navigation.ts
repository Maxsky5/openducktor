import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef } from "react";
import { routes, sessionParams } from "@/navigation/routes";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";

/** Leaves a workflow sheet, and opens a session or a task in the tab below it. */
export function useSheetNavigation(workspaceId: string) {
  const router = useRouter();
  // A sheet leaves once, also when two flows finish in the same moment.
  const left = useRef(false);
  const close = useCallback(() => {
    if (left.current) return;
    left.current = true;
    // Dismiss the sheet instead of following the focused tab's back history.
    router.dismiss();
  }, [router]);
  const openSession = useCallback(
    (identity: AgentSessionIdentity) => {
      close();
      router.push(routes.session(sessionParams(workspaceId, identity)));
    },
    [close, router, workspaceId],
  );
  // A navigate shows the task below the sheet when the sheet opened from it, without a copy.
  const openTask = useCallback(
    (taskId: string) => {
      close();
      router.navigate(routes.task(workspaceId, taskId));
    },
    [close, router, workspaceId],
  );
  return useMemo(() => ({ close, openSession, openTask }), [close, openSession, openTask]);
}
