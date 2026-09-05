import { useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { useWorkspaceState } from "@/state/app-state-provider";
import { useNotificationContext } from "@/state/notifications/notification-context";
import { loadAgentSessionListFromQuery } from "@/state/queries/agent-sessions";
import { unfilteredRepoTaskDataQueryOptions } from "@/state/queries/tasks";
import {
  ATTENTION_ID_QUERY_KEY,
  ATTENTION_KIND_QUERY_KEY,
  findNotificationAttentionTarget,
  openNotificationTarget,
} from "./notification-navigation-logic";

const staleTarget = (message: string): void => {
  toast.error("Notification target is no longer available", { description: message });
};

export function NotificationNavigationRegistrar(): null {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { workspaces, activeWorkspace, selectWorkspace } = useWorkspaceState();
  const { registerNavigator } = useNotificationContext();

  useEffect(() => {
    return registerNavigator(async (target) => {
      await openNotificationTarget(
        target,
        {
          activeWorkspaceId: activeWorkspace?.workspaceId ?? null,
          workspaces,
          selectWorkspace,
          loadTasks: async (repoPath) => {
            const taskOptions = unfilteredRepoTaskDataQueryOptions(repoPath);
            return (await queryClient.fetchQuery({ ...taskOptions, staleTime: 0 })).tasks;
          },
          loadTaskSessions: (repoPath, taskId) =>
            loadAgentSessionListFromQuery(queryClient, repoPath, taskId, { forceFresh: true }),
          navigate,
          reportStale: staleTarget,
        },
        (message) =>
          toast.error("Could not open notification", {
            description: message,
            action: { label: "Reload", onClick: () => window.location.reload() },
          }),
      );
    });
  }, [
    activeWorkspace?.workspaceId,
    navigate,
    queryClient,
    registerNavigator,
    selectWorkspace,
    workspaces,
  ]);

  return null;
}

export function NotificationAttentionFocus(): ReactElement | null {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (location.pathname !== "/agents") return;
    const search = new URLSearchParams(location.search);
    const kind = search.get(ATTENTION_KIND_QUERY_KEY);
    const id = search.get(ATTENTION_ID_QUERY_KEY);
    if (!kind || !id) return;

    const clearAttention = (): void => {
      search.delete(ATTENTION_KIND_QUERY_KEY);
      search.delete(ATTENTION_ID_QUERY_KEY);
      const query = search.toString();
      navigate(`${location.pathname}${query ? `?${query}` : ""}`, {
        replace: true,
        state: location.state,
      });
    };
    const focus = (): boolean => {
      const target = findNotificationAttentionTarget(kind, id);
      if (!target) return false;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
      clearAttention();
      return true;
    };
    if (focus()) return;

    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      staleTarget("The requested input or error is no longer visible in this session.");
      clearAttention();
    }, 5_000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [location.pathname, location.search, location.state, navigate]);

  return null;
}
