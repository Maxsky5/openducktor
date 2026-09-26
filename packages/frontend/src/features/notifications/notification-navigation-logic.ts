import type {
  AgentRole,
  AgentSessionRecord,
  NotificationNavigationTarget,
  TaskCard,
  WorkspaceSession,
} from "@openducktor/contracts";
import { buildAgentStudioHref } from "@/pages/agents/query-sync/agent-studio-navigation";
import { findWorkspaceSessionByIdentity } from "@/state/queries/agent-session-association";
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
  loadWorkspaceSessions: (workspaceId: string) => Promise<WorkspaceSession[]>;
  navigate: (href: string, options?: { state?: unknown }) => void;
  reportStale: (message: string) => void;
  openSettings(): void;
  beforeNavigate?: (selectWorkspace: () => Promise<void>) => Promise<boolean>;
};

export const navigateToNotificationTarget = async (
  target: NotificationNavigationTarget,
  dependencies: NotificationNavigationDependencies,
): Promise<void> => {
  if (target.type === "notification_settings") {
    dependencies.openSettings();
    return;
  }
  const workspace = dependencies.workspaces.find((entry) => entry.repoPath === target.repoPath);
  if (!workspace) {
    dependencies.reportStale("The repository is not loaded in OpenDucktor.");
    return;
  }

  const selectWorkspace = () =>
    dependencies.activeWorkspaceId === workspace.workspaceId
      ? Promise.resolve()
      : dependencies.selectWorkspace(workspace.workspaceId);
  const workspaceSelection = dependencies.beforeNavigate ? null : selectWorkspace();
  const open = async (href?: string, options?: { state?: unknown }) => {
    if (dependencies.beforeNavigate) {
      if (!(await dependencies.beforeNavigate(selectWorkspace))) return;
    } else await workspaceSelection;
    if (href) {
      if (options) dependencies.navigate(href, options);
      else dependencies.navigate(href);
    }
  };

  const taskId = "taskId" in target ? target.taskId : undefined;
  if (!taskId) {
    if (target.type === "agent_studio_task" || target.type === "kanban_task") {
      await open();
      return;
    }
    const [records] = await Promise.all([
      dependencies.loadWorkspaceSessions(workspace.workspaceId),
      workspaceSelection,
    ]);
    const session = findWorkspaceSessionByIdentity(records, target.session);
    if (!session || session.archivedAt !== null) {
      dependencies.reportStale("The exact Workspace Session is no longer available.");
      return;
    }
    const href = `/chats?session=${encodeURIComponent(session.id)}`;
    await open(target.type === "agent_session" ? href : addNotificationAttention(href, target), {
      state: { notificationTarget: target },
    });
    return;
  }

  const [tasks] = await Promise.all([dependencies.loadTasks(target.repoPath), workspaceSelection]);
  const task = tasks.find((entry) => entry.id === taskId);
  if (!task) {
    dependencies.reportStale(`Task ${taskId} no longer exists in this repository.`);
    return;
  }

  if (target.type === "kanban_task") {
    await open(`/kanban?task=${encodeURIComponent(target.taskId)}`);
    return;
  }

  if (target.type === "agent_studio_task") {
    await open(
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
  await open(target.type === "agent_session" ? href : addNotificationAttention(href, target), {
    state: { notificationTarget: target },
  });
};

export const findNotificationAttentionTarget = (kind: string, id: string): HTMLElement | null => {
  if (kind !== "permission" && kind !== "question" && kind !== "error") return null;
  const candidates = document.querySelectorAll<HTMLElement>("[data-notification-attention-kind]");
  return (
    Array.from(candidates).find(
      (element) =>
        element.dataset.notificationAttentionKind === kind &&
        element.dataset.notificationAttentionId === id,
    ) ?? null
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
