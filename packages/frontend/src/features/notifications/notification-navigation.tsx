import type {
  AgentSessionRecord,
  AgentRole,
  NotificationNavigationTarget,
  TaskCard,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { buildAgentStudioHref } from "@/pages/agents/query-sync/agent-studio-navigation";
import { useWorkspaceState } from "@/state/app-state-provider";
import { useNotificationContext } from "@/state/notifications/notification-context";
import { loadAgentSessionListFromQuery } from "@/state/queries/agent-sessions";
import { unfilteredRepoTaskDataQueryOptions } from "@/state/queries/tasks";

const ATTENTION_KIND_QUERY_KEY = "attention";
const ATTENTION_ID_QUERY_KEY = "attentionId";

const roleForTask = (task: TaskCard): AgentRole => {
  if (task.status === "open") return "spec";
  if (task.status === "spec_ready") return "planner";
  if (
    task.status === "ready_for_dev" ||
    task.status === "in_progress" ||
    task.status === "blocked"
  ) {
    return "build";
  }
  return "qa";
};

const staleTarget = (message: string): void => {
  toast.error("Notification target is no longer available", { description: message });
};

export const addNotificationAttention = (
  href: string,
  target: Extract<NotificationNavigationTarget, { type: "pending_input" | "session_error" }>,
): string => {
  const [path, query = ""] = href.split("?");
  const search = new URLSearchParams(query);
  search.set(
    ATTENTION_KIND_QUERY_KEY,
    target.type === "session_error" ? "error" : target.inputKind,
  );
  search.set(
    ATTENTION_ID_QUERY_KEY,
    target.type === "session_error" ? target.errorId : target.requestId,
  );
  return `${path}?${search.toString()}`;
};

export const matchesNotificationSession = (
  session: AgentSessionRecord,
  target: Extract<
    NotificationNavigationTarget,
    { type: "agent_session" | "pending_input" | "session_error" }
  >,
): boolean =>
  session.externalSessionId === target.session.externalSessionId &&
  session.runtimeKind === target.session.runtimeKind &&
  session.workingDirectory === target.session.workingDirectory;

export function NotificationNavigationRegistrar(): null {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { workspaces, activeWorkspace, selectWorkspace } = useWorkspaceState();
  const { registerNavigator } = useNotificationContext();

  useEffect(() => {
    return registerNavigator(async (target) => {
      const workspace = workspaces.find((entry) => entry.repoPath === target.repoPath);
      if (!workspace) {
        staleTarget("The repository is not loaded in OpenDucktor.");
        return;
      }

      const taskOptions = unfilteredRepoTaskDataQueryOptions(target.repoPath);
      const tasks = (await queryClient.fetchQuery({ ...taskOptions, staleTime: 0 })).tasks;
      const taskId = "taskId" in target ? target.taskId : undefined;
      const task = taskId ? tasks.find((entry) => entry.id === taskId) : undefined;
      if (taskId && !task) {
        staleTarget(`Task ${taskId} no longer exists in this repository.`);
        return;
      }

      if (activeWorkspace?.workspaceId !== workspace.workspaceId) {
        await selectWorkspace(workspace.workspaceId);
      }

      if (target.type === "kanban_task") {
        navigate(`/kanban?task=${encodeURIComponent(target.taskId)}`);
        return;
      }

      if (target.type === "agent_studio_task") {
        if (!task) return;
        navigate(
          buildAgentStudioHref({
            taskId: task.id,
            sessionExternalId: null,
            role: target.preferredRole ?? roleForTask(task),
          }),
        );
        return;
      }

      if (!taskId || !task) {
        staleTarget("This repository session is not linked to a task that Agent Studio can open.");
        return;
      }
      const sessions = await loadAgentSessionListFromQuery(queryClient, target.repoPath, taskId, {
        forceFresh: true,
      });
      const session = sessions.find((entry) => matchesNotificationSession(entry, target));
      if (!session) {
        staleTarget("The exact Agent Session is no longer available.");
        return;
      }

      const href = buildAgentStudioHref({
        taskId,
        sessionExternalId: session.externalSessionId,
        role: session.role,
      });
      navigate(target.type === "agent_session" ? href : addNotificationAttention(href, target));
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

const findAttentionTarget = (kind: string, id: string): HTMLElement | null => {
  const candidates = document.querySelectorAll<HTMLElement>(
    `[data-notification-attention-kind="${kind}"]`,
  );
  return (
    Array.from(candidates).find((element) => {
      const candidateId = element.dataset.notificationAttentionId;
      return kind === "error" || candidateId === id;
    }) ?? null
  );
};

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
      navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true });
    };
    const focus = (): boolean => {
      const target = findAttentionTarget(kind, id);
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
  }, [location.pathname, location.search, navigate]);

  return null;
}
