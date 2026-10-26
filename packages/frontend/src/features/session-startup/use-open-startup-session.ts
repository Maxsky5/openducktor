import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { useMountedRef } from "@openducktor/frontend-core/lib/use-mounted-ref";
import type { StartupAttempt } from "@openducktor/frontend-core/sessions/startup/startup-attempt-store";
import { canOpenStartupSession } from "@openducktor/frontend-core/sessions/startup/startup-navigation";
import { useWorkspaceState } from "@/state/app-state-provider";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import { buildSessionNavigationHref } from "@/features/session-navigation/sessions-route";

export function useOpenStartupSession(attempt: StartupAttempt | null) {
  const connection = useClientConnection();
  const navigate = useNavigate();
  const { workspaces, activeWorkspace, selectWorkspace } = useWorkspaceState();
  const { run: guardTransition } = useWorkspacePreviewTransitionGuard();
  const [openError, setOpenError] = useState<string | null>(null);
  const pendingNavigation = useRef<Promise<boolean> | null>(null);
  const mounted = useMountedRef();
  const openSession = (): Promise<boolean> => {
    if (pendingNavigation.current) return pendingNavigation.current;
    if (!attempt) return Promise.resolve(false);
    const requestedAttempt = connection.startupAttempts.getAttempt(attempt.id);
    if (!canOpenStartupSession(requestedAttempt)) return Promise.resolve(false);
    const target = requestedAttempt.navigationTarget;
    const workspace = workspaces.find(
      (entry) =>
        entry.workspaceId === target.workspaceId && entry.repoPath === attempt.origin.repoPath,
    );
    if (!workspace) {
      setOpenError("The originating workspace is no longer available.");
      return Promise.resolve(false);
    }
    const completion = Promise.withResolvers<boolean>();
    pendingNavigation.current = completion.promise;
    const finish = (opened: boolean) => {
      pendingNavigation.current = null;
      completion.resolve(opened);
    };
    guardTransition(
      async () => {
        try {
          if (activeWorkspace?.workspaceId !== workspace.workspaceId)
            await selectWorkspace(workspace.workspaceId);
          const latestAttempt = connection.startupAttempts.getAttempt(attempt.id);
          if (!mounted.current || !canOpenStartupSession(latestAttempt)) {
            finish(false);
            return false;
          }
          const latestTarget = latestAttempt.navigationTarget;
          await navigate(buildSessionNavigationHref(latestTarget), {
            state:
              latestTarget.kind === "task_session"
                ? {
                    notificationTarget: {
                      type: "agent_session",
                      repoPath: attempt.origin.repoPath,
                      taskId: latestTarget.taskId,
                      session: latestTarget.identity,
                    },
                  }
                : undefined,
          });
          connection.startupAttempts.handoff(attempt.id);
          finish(true);
          return true;
        } catch (cause) {
          setOpenError(cause instanceof Error ? cause.message : String(cause));
          finish(false);
          return false;
        }
      },
      () => finish(false),
      { waitForSuccess: true },
    );
    return completion.promise;
  };
  return { openSession, openError };
}
