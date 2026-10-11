import { useEffect } from "react";
import { useVisibleSessionTarget } from "@/features/session-navigation/visible-session-target";
import { recordRecentItem } from "./recent-items";

/** Add each task or chat that the app shows to the Recent list, however the user opened it. */
export function RecentItemsRecorder(): null {
  const target = useVisibleSessionTarget();
  useEffect(() => {
    if (!target) return;
    if (target.kind === "workspace_session") {
      recordRecentItem({
        kind: "chat",
        workspaceId: target.workspaceId,
        sessionId: target.sessionId,
      });
      return;
    }
    recordRecentItem({ kind: "task", workspaceId: target.workspaceId, taskId: target.taskId });
  }, [target]);
  return null;
}
