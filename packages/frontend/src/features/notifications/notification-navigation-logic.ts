import type {
  AgentRole,
  AgentSessionRecord,
  NotificationNavigationTarget,
  TaskCard,
} from "@openducktor/contracts";
import { buildAgentStudioHref } from "@/pages/agents/query-sync/agent-studio-navigation";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";

export const ATTENTION_KIND_QUERY_KEY = "attention";
export const ATTENTION_ID_QUERY_KEY = "attentionId";

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
): boolean => matchesAgentSessionIdentity(session, target.session);

type NotificationNavigationDependencies = {
  activeWorkspaceId: string | null;
  workspaces: Array<{ workspaceId: string; repoPath: string }>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  loadTasks: (repoPath: string) => Promise<TaskCard[]>;
  loadTaskSessions: (repoPath: string, taskId: string) => Promise<AgentSessionRecord[]>;
  navigate: (href: string, options?: { state?: unknown }) => void;
  reportStale: (message: string) => void;
};

export const navigateToNotificationTarget = async (
  target: NotificationNavigationTarget,
  dependencies: NotificationNavigationDependencies,
): Promise<void> => {
  const workspace = dependencies.workspaces.find((entry) => entry.repoPath === target.repoPath);
  if (!workspace) {
    dependencies.reportStale("The repository is not loaded in OpenDucktor.");
    return;
  }

  const workspaceSelection =
    dependencies.activeWorkspaceId === workspace.workspaceId
      ? Promise.resolve()
      : dependencies.selectWorkspace(workspace.workspaceId);

  const taskId = "taskId" in target ? target.taskId : undefined;
  if (!taskId) {
    await workspaceSelection;
    if (target.type === "agent_studio_task" || target.type === "kanban_task") {
      return;
    }
    dependencies.reportStale("Repository session notifications cannot be opened yet.");
    return;
  }

  const [tasks] = await Promise.all([dependencies.loadTasks(target.repoPath), workspaceSelection]);
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task) {
    dependencies.reportStale(`Task ${taskId} no longer exists in this repository.`);
    return;
  }

  if (target.type === "kanban_task") {
    dependencies.navigate(`/kanban?task=${encodeURIComponent(target.taskId)}`);
    return;
  }

  if (target.type === "agent_studio_task") {
    dependencies.navigate(
      buildAgentStudioHref({
        taskId: task.id,
        sessionExternalId: null,
        role: target.preferredRole ?? roleForTask(task),
      }),
    );
    return;
  }

  const sessions = await dependencies.loadTaskSessions(target.repoPath, taskId);
  const session = sessions.find((entry) => matchesNotificationSession(entry, target));
  if (!session) {
    dependencies.reportStale("The exact Agent Session is no longer available.");
    return;
  }

  const href = buildAgentStudioHref({
    taskId,
    sessionExternalId: session.externalSessionId,
    role: session.role,
  });
  dependencies.navigate(
    target.type === "agent_session" ? href : addNotificationAttention(href, target),
    { state: { notificationTarget: target } },
  );
};

export const findNotificationAttentionTarget = (kind: string, id: string): HTMLElement | null => {
  const candidates = document.querySelectorAll<HTMLElement>(
    `[data-notification-attention-kind="${kind}"]`,
  );
  return (
    Array.from(candidates).find((element) => element.dataset.notificationAttentionId === id) ?? null
  );
};

export const openNotificationTarget = async (
  target: NotificationNavigationTarget,
  dependencies: NotificationNavigationDependencies,
  reportFailure: (message: string) => void,
): Promise<void> => {
  try {
    await navigateToNotificationTarget(target, dependencies);
  } catch {
    reportFailure(
      "OpenDucktor could not load this notification target. Reload and open the notification again.",
    );
  }
};
