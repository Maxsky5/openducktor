import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { useSettingsModal } from "@/components/features/settings/settings-modal";
import { useWorkspacePreviewTransitionGuard } from "@/components/layout/workspace-preview-transition-guard";
import {
  parseSessionsPageKind,
  SESSIONS_PATH,
  SESSIONS_QUERY_KEYS,
} from "@/features/session-navigation/sessions-route";
import { useWorkspaceState } from "@/state/app-state-provider";
import { useNotificationContext } from "@/state/notifications/notification-context";
import { workspaceSessionListQueryOptions } from "@openducktor/frontend-core/queries/workspace-sessions";
import { loadAgentSessionListFromQuery } from "@openducktor/frontend-core/queries/agent-sessions";
import { unfilteredRepoTaskDataQueryOptions } from "@openducktor/frontend-core/queries/tasks";
import {
  notificationTargetReplacesContent,
  openNotificationTarget,
} from "./notification-navigation-logic";

import { reportStaleNotificationTarget } from "./notification-target-error";

export function NotificationNavigationRegistrar(): null {
  const { openSettings } = useSettingsModal();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { run: guardWorkspaceChange } = useWorkspacePreviewTransitionGuard();
  const { workspaces, activeWorkspace, selectWorkspace } = useWorkspaceState();
  const { registerNavigator } = useNotificationContext();

  useEffect(() => {
    return registerNavigator(async (target) => {
      let beforeNavigate: ((selectWorkspace: () => Promise<void>) => Promise<boolean>) | undefined;
      // Session content can hold unsaved file edits that a new target would replace.
      if (target.type !== "notification_settings" && location.pathname === SESSIONS_PATH) {
        const targetWorkspace = workspaces.find(
          (entry) =>
            entry.repoPath === target.repoPath &&
            (target.workspaceId === undefined || entry.workspaceId === target.workspaceId),
        );
        const visibleKind = parseSessionsPageKind(
          new URLSearchParams(location.search).get(SESSIONS_QUERY_KEYS.kind),
        );
        if (
          targetWorkspace &&
          notificationTargetReplacesContent(
            target,
            targetWorkspace.workspaceId,
            activeWorkspace?.workspaceId ?? null,
            visibleKind,
          )
        )
          beforeNavigate = (selectWorkspace) =>
            new Promise<boolean>((resolve, reject) => {
              guardWorkspaceChange(
                async () => {
                  try {
                    await selectWorkspace();
                    resolve(true);
                    return true;
                  } catch (cause) {
                    reject(cause);
                    return false;
                  }
                },
                () => resolve(false),
                { waitForSuccess: true },
              );
            });
      }
      const dependencies: Parameters<typeof openNotificationTarget>[1] = {
        activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
        workspaces,
        selectWorkspace,
        loadTasks: async (workspace) => {
          const taskOptions = unfilteredRepoTaskDataQueryOptions(workspace);
          return (await queryClient.fetchQuery({ ...taskOptions, staleTime: 0 })).tasks;
        },
        loadTaskSessions: (workspace, taskId) =>
          loadAgentSessionListFromQuery(queryClient, workspace, taskId, { forceFresh: true }),
        loadWorkspaceSessions: (workspaceId) =>
          queryClient.fetchQuery(workspaceSessionListQueryOptions(workspaceId)),
        navigate,
        reportStale: reportStaleNotificationTarget,
        openSettings: () =>
          openSettings({ deepLink: { kind: "global", section: "notifications" } }),
      };
      if (beforeNavigate) dependencies.beforeNavigate = beforeNavigate;
      await openNotificationTarget(target, dependencies, (message) =>
        toast.error("Could not open notification", {
          description: message,
          action: { label: "Reload", onClick: () => window.location.reload() },
        }),
      );
    });
  }, [
    activeWorkspace?.workspaceId,
    guardWorkspaceChange,
    location.pathname,
    location.search,
    navigate,
    openSettings,
    queryClient,
    registerNavigator,
    selectWorkspace,
    workspaces,
  ]);

  return null;
}
