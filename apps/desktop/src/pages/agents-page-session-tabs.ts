import type { AgentStudioTaskTab } from "@/components/features/agents/agent-studio-task-tabs";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { TaskAction, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";

type PersistedTaskTabsPayload = {
  tabs: string[];
  activeTaskId?: string | null;
};

export type PersistedTaskTabsState = {
  tabs: string[];
  activeTaskId: string | null;
};

const ALL_AGENT_ROLES: AgentRole[] = ["spec", "planner", "build", "qa"];

const DEFAULT_PERSISTED_TABS_STATE: PersistedTaskTabsState = {
  tabs: [],
  activeTaskId: null,
};

const WORKFLOW_ACTIONS_BY_ROLE: Record<Exclude<AgentRole, "qa">, ReadonlySet<TaskAction>> = {
  spec: new Set<TaskAction>(["set_spec"]),
  planner: new Set<TaskAction>(["set_plan"]),
  build: new Set<TaskAction>(["build_start", "open_builder"]),
};

const normalizeTaskTabs = (entries: unknown): string[] => {
  if (!Array.isArray(entries)) {
    return [];
  }
  return Array.from(
    new Set(
      entries.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      ),
    ),
  );
};

export const buildLatestSessionByTaskMap = (
  sessions: AgentSessionState[],
): Map<string, AgentSessionState> => {
  const sortedSessions = [...sessions].sort((a, b) => {
    if (a.startedAt !== b.startedAt) {
      return a.startedAt > b.startedAt ? -1 : 1;
    }
    if (a.sessionId === b.sessionId) {
      return 0;
    }
    return a.sessionId > b.sessionId ? -1 : 1;
  });
  const next = new Map<string, AgentSessionState>();
  for (const entry of sortedSessions) {
    if (!next.has(entry.taskId)) {
      next.set(entry.taskId, entry);
    }
  }
  return next;
};

export const ensureActiveTaskTab = (openTaskTabs: string[], activeTaskId: string): string[] => {
  if (!activeTaskId || openTaskTabs.includes(activeTaskId)) {
    return openTaskTabs;
  }
  return [...openTaskTabs, activeTaskId];
};

export const parsePersistedTaskTabs = (raw: string | null): PersistedTaskTabsState => {
  if (!raw) {
    return DEFAULT_PERSISTED_TABS_STATE;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed)) {
      return {
        tabs: normalizeTaskTabs(parsed),
        activeTaskId: null,
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_PERSISTED_TABS_STATE;
    }

    const payload = parsed as PersistedTaskTabsPayload;
    const tabs = normalizeTaskTabs(payload.tabs);
    const activeTaskId =
      typeof payload.activeTaskId === "string" && payload.activeTaskId.trim().length > 0
        ? payload.activeTaskId
        : null;
    return {
      tabs,
      activeTaskId,
    };
  } catch {
    return DEFAULT_PERSISTED_TABS_STATE;
  }
};

export const toPersistedTaskTabs = (state: PersistedTaskTabsState): string => {
  const activeTaskId =
    state.activeTaskId && state.tabs.includes(state.activeTaskId) ? state.activeTaskId : null;
  return JSON.stringify({
    tabs: normalizeTaskTabs(state.tabs),
    activeTaskId,
  } satisfies PersistedTaskTabsPayload);
};

export const resolveFallbackTaskId = (params: {
  tabTaskIds: string[];
  persistedActiveTaskId: string | null;
}): string | null => {
  if (params.persistedActiveTaskId && params.tabTaskIds.includes(params.persistedActiveTaskId)) {
    return params.persistedActiveTaskId;
  }
  return params.tabTaskIds[0] ?? null;
};

export const canPersistTaskTabs = (
  activeRepo: string | null,
  tabsStorageHydratedRepo: string | null,
): boolean => {
  return Boolean(activeRepo) && tabsStorageHydratedRepo === activeRepo;
};

export const buildRoleEnabledMapForTask = (task: TaskCard | null): Record<AgentRole, boolean> => {
  if (!task) {
    return {
      spec: true,
      planner: true,
      build: true,
      qa: true,
    };
  }

  const availableActions = new Set(task.availableActions);
  const map: Record<AgentRole, boolean> = {
    spec: false,
    planner: false,
    build: false,
    qa: task.status === "ai_review",
  };

  for (const role of ALL_AGENT_ROLES) {
    if (role === "qa") {
      continue;
    }
    const requiredActions = WORKFLOW_ACTIONS_BY_ROLE[role];
    map[role] = Array.from(requiredActions).some((action) => availableActions.has(action));
  }

  return map;
};

export const getAvailableTabTasks = (tasks: TaskCard[], tabTaskIds: string[]): TaskCard[] => {
  return tasks.filter((task) => !tabTaskIds.includes(task.id));
};

export const getTabStatusFromSession = (
  session: AgentSessionState | null | undefined,
): AgentStudioTaskTab["status"] => {
  if (!session) {
    return "idle";
  }
  if (session.pendingPermissions.length > 0 || session.pendingQuestions.length > 0) {
    return "waiting_input";
  }
  if (session.status === "starting" || session.status === "running") {
    return "working";
  }
  return "idle";
};

export const buildTaskTabs = (params: {
  tabTaskIds: string[];
  tasks: TaskCard[];
  latestSessionByTaskId: Map<string, AgentSessionState>;
  activeTaskId: string;
}): AgentStudioTaskTab[] => {
  return params.tabTaskIds.map((tabTaskId) => {
    const task = params.tasks.find((entry) => entry.id === tabTaskId);
    const session = params.latestSessionByTaskId.get(tabTaskId);

    return {
      taskId: tabTaskId,
      taskTitle: task?.title ?? tabTaskId,
      status: getTabStatusFromSession(session),
      isActive: params.activeTaskId === tabTaskId,
    };
  });
};

export const closeTaskTab = (params: {
  tabTaskIds: string[];
  taskIdToClose: string;
  activeTaskId: string;
}): { nextTabTaskIds: string[]; nextActiveTaskId: string | null } => {
  const closeIndex = params.tabTaskIds.indexOf(params.taskIdToClose);
  if (closeIndex < 0) {
    return {
      nextTabTaskIds: params.tabTaskIds,
      nextActiveTaskId: params.activeTaskId || null,
    };
  }

  const nextTabTaskIds = params.tabTaskIds.filter((taskId) => taskId !== params.taskIdToClose);
  if (params.taskIdToClose !== params.activeTaskId) {
    return {
      nextTabTaskIds,
      nextActiveTaskId: params.activeTaskId || null,
    };
  }

  const adjacentTab =
    closeIndex >= nextTabTaskIds.length
      ? (nextTabTaskIds[nextTabTaskIds.length - 1] ?? null)
      : (nextTabTaskIds[closeIndex] ?? null);

  return {
    nextTabTaskIds,
    nextActiveTaskId: adjacentTab,
  };
};
