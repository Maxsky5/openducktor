import { useCallback, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { useSessionViewActive } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import type { SessionNavigationTarget } from "@openducktor/frontend-core/sessions/navigation/session-navigation-target";
import { buildSessionNavigationHref } from "@/features/session-navigation/sessions-route";

export function useForkNavigation(ownerKey: string, visible = true) {
  const navigate = useNavigate();
  const location = useLocation();
  const active = useSessionViewActive() && visible;
  const current = useRef({ key: "", active: false, revision: 0, mounted: true });
  const key = JSON.stringify([location.key, ownerKey]);
  useLayoutEffect(() => {
    if (current.current.key !== key || current.current.active !== active)
      current.current.revision += 1;
    current.current.key = key;
    current.current.active = active;
    current.current.mounted = true;
  }, [key, active]);
  useLayoutEffect(
    () => () => {
      current.current.mounted = false;
    },
    [],
  );
  return useCallback(() => {
    const revision = current.current.revision;
    return (target: SessionNavigationTarget, repoPath: string) => {
      if (
        !current.current.mounted ||
        !current.current.active ||
        current.current.revision !== revision
      )
        return false;
      void navigate(buildSessionNavigationHref(target), {
        state:
          target.kind === "task_session"
            ? {
                notificationTarget: {
                  type: "agent_session",
                  repoPath,
                  taskId: target.taskId,
                  session: target.identity,
                },
              }
            : undefined,
      });
      return true;
    };
  }, [navigate]);
}
