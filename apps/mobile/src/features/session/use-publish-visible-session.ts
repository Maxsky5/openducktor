import { usePublishVisibleSessionTarget } from "@openducktor/frontend-core/sessions/navigation/visible-session-target";
import { useIsFocused } from "expo-router";
import { useMemo } from "react";
import type { SessionTarget } from "./session-target";
import { visibleSessionTargetFor } from "./session-visible-target";

/**
 * Publishes the session as the one on screen while its screen has focus, so the session read
 * state clears its unread mark. Tab stacks keep hidden screens mounted, so focus decides.
 */
export function usePublishVisibleSession(target: SessionTarget): void {
  const focused = useIsFocused();
  const visible = useMemo(
    () => (focused && !target.readOnly ? visibleSessionTargetFor(target) : null),
    [focused, target],
  );
  usePublishVisibleSessionTarget(
    visible,
    visible?.kind === "workspace_session" ? target.identity : null,
  );
}
