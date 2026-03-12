import type { AgentWorkflowState, TaskCard } from "@openducktor/contracts";
import { type AgentRole, type AgentScenario, isRecord } from "@openducktor/core";
import type { AgentStudioTaskTab } from "@/components/features/agents";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { buildRoleWorkflowMapForTask as resolveRoleWorkflowMapForTask } from "@/lib/task-agent-workflows";
import { isQaRejectedTask } from "@/lib/task-qa";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentWorkflowStepState } from "@/types/agent-workflow";

type PersistedTaskTabsPayload = {
  tabs: string[];
  activeTaskId?: string | null;
};

export type PersistedTaskTabsState = {
  tabs: string[];
  activeTaskId: string | null;
};

export type WorkflowStepState = AgentWorkflowStepState;

export type SessionCreateOption = {
  id: string;
  role: AgentRole;
  scenario: AgentScenario;
  label: string;
  description: string;
  disabled: boolean;
};

const ALL_AGENT_ROLES: AgentRole[] = ["spec", "planner", "build", "qa"];

const DEFAULT_PERSISTED_TABS_STATE: PersistedTaskTabsState = {
  tabs: [],
  activeTaskId: null,
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
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return {
        tabs: normalizeTaskTabs(parsed),
        activeTaskId: null,
      };
    }

    if (!isRecord(parsed)) {
      return DEFAULT_PERSISTED_TABS_STATE;
    }

    const tabs = normalizeTaskTabs(parsed.tabs);
    const activeTaskId =
      typeof parsed.activeTaskId === "string" && parsed.activeTaskId.trim().length > 0
        ? parsed.activeTaskId
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
  const workflowsByRole = resolveRoleWorkflowMapForTask(task);
  return {
    spec: workflowsByRole.spec.available,
    planner: workflowsByRole.planner.available,
    build: workflowsByRole.build.available,
    qa: workflowsByRole.qa.available,
  };
};

export const buildWorkflowStateByRole = (params: {
  task: TaskCard | null;
  roleWorkflowsByTask: Record<AgentRole, AgentWorkflowState>;
  latestSessionByRole: Record<AgentRole, AgentSessionState | null>;
}): Record<AgentRole, WorkflowStepState> => {
  const stateByRole: Record<AgentRole, WorkflowStepState> = {
    spec: "blocked",
    planner: "blocked",
    build: "blocked",
    qa: "blocked",
  };
  const qaRejected = isQaRejectedTask(params.task);

  for (const role of ALL_AGENT_ROLES) {
    const latestRoleSession = params.latestSessionByRole[role];
    const hasRunningRoleSession =
      latestRoleSession?.status === "starting" || latestRoleSession?.status === "running";
    if (hasRunningRoleSession) {
      stateByRole[role] = "in_progress";
      continue;
    }
    if (role === "build" && qaRejected) {
      stateByRole[role] = "done";
      continue;
    }
    if (
      role === "build" &&
      latestRoleSession?.scenario === "build_after_qa_rejected" &&
      (latestRoleSession.status === "idle" || latestRoleSession.status === "stopped") &&
      params.roleWorkflowsByTask.qa.completed &&
      !qaRejected
    ) {
      stateByRole[role] = "done";
      continue;
    }
    if (role === "qa" && qaRejected) {
      stateByRole[role] = "rejected";
      continue;
    }
    if (params.roleWorkflowsByTask[role].completed) {
      stateByRole[role] = "done";
      continue;
    }
    const hasStartedRoleSession = latestRoleSession?.status === "idle";
    if (params.roleWorkflowsByTask[role].available && hasStartedRoleSession) {
      stateByRole[role] = "in_progress";
      continue;
    }
    if (params.roleWorkflowsByTask[role].available) {
      stateByRole[role] = "available";
      continue;
    }
    if (params.roleWorkflowsByTask[role].canSkip) {
      stateByRole[role] = "optional";
      continue;
    }
    stateByRole[role] = "blocked";
  }

  return stateByRole;
};

export const buildLatestSessionByRoleMap = (
  sessionsForTask: AgentSessionState[],
): Record<AgentRole, AgentSessionState | null> => {
  const map: Record<AgentRole, AgentSessionState | null> = {
    spec: null,
    planner: null,
    build: null,
    qa: null,
  };

  const sortedSessions = [...sessionsForTask].sort((a, b) => {
    if (a.startedAt !== b.startedAt) {
      return a.startedAt > b.startedAt ? -1 : 1;
    }
    if (a.sessionId === b.sessionId) {
      return 0;
    }
    return a.sessionId > b.sessionId ? -1 : 1;
  });

  for (const role of ALL_AGENT_ROLES) {
    map[role] = sortedSessions.find((entry) => entry.role === role) ?? null;
  }

  return map;
};

const describeSessionOption = (session: AgentSessionState): string => {
  const startedAt = new Date(session.startedAt);
  const startedAtLabel = Number.isNaN(startedAt.getTime())
    ? session.startedAt
    : startedAt.toLocaleString();
  return `${startedAtLabel} · ${session.status} · ${session.sessionId.slice(0, 8)}`;
};

export const buildSessionSelectorGroups = (params: {
  sessionsForTask: AgentSessionState[];
  scenarioLabels: Record<AgentScenario, string>;
  roleLabelByRole: Record<AgentRole, string>;
}): ComboboxGroup[] => {
  const groups: ComboboxGroup[] = [];

  for (const role of ALL_AGENT_ROLES) {
    const roleSessions = params.sessionsForTask.filter((entry) => entry.role === role);
    if (roleSessions.length === 0) {
      continue;
    }
    const roleSessionNumberById = new Map(
      [...roleSessions]
        .sort((a, b) => {
          if (a.startedAt !== b.startedAt) {
            return a.startedAt < b.startedAt ? -1 : 1;
          }
          if (a.sessionId === b.sessionId) {
            return 0;
          }
          return a.sessionId < b.sessionId ? -1 : 1;
        })
        .map((session, index) => [session.sessionId, index + 1]),
    );
    const roleOptions: ComboboxOption[] = roleSessions.map((session, index) => ({
      value: session.sessionId,
      label: (() => {
        const scenarioLabel = params.scenarioLabels[session.scenario];
        const roleLabel = params.roleLabelByRole[session.role];
        const baseLabel =
          scenarioLabel === roleLabel ? roleLabel : `${scenarioLabel} · ${roleLabel}`;
        const sessionNumber = roleSessionNumberById.get(session.sessionId) ?? index + 1;
        return `${baseLabel} #${sessionNumber}`;
      })(),
      description: describeSessionOption(session),
      searchKeywords: [role, session.scenario, session.sessionId],
    }));
    groups.push({
      label: params.roleLabelByRole[role],
      options: roleOptions,
    });
  }

  return groups;
};

export const buildSessionCreateOptions = (params: {
  roleEnabledByTask: Record<AgentRole, boolean>;
  hasQaRejection: boolean;
  hasHumanFeedback: boolean;
  createSessionDisabled: boolean;
  roleLabelByRole: Record<AgentRole, string>;
  scenarioLabels: Record<AgentScenario, string>;
}): SessionCreateOption[] => {
  const options: SessionCreateOption[] = [];

  const addFreshOption = (
    role: AgentRole,
    scenario: AgentScenario,
    label: string,
    description: string,
    disabled: boolean,
  ) => {
    options.push({
      id: `${role}:${scenario}:fresh`,
      role,
      scenario,
      label,
      description,
      disabled,
    });
  };

  if (params.roleEnabledByTask.spec) {
    addFreshOption(
      "spec",
      "spec_initial",
      `${params.roleLabelByRole.spec} · Start Spec`,
      "Create a new spec session from scratch",
      params.createSessionDisabled,
    );
  }

  const canStartPlannerFresh = params.roleEnabledByTask.planner;
  if (canStartPlannerFresh) {
    addFreshOption(
      "planner",
      "planner_initial",
      `${params.roleLabelByRole.planner} · Start Planner`,
      "Create a new planner session from scratch",
      params.createSessionDisabled,
    );
  }

  if (params.roleEnabledByTask.build) {
    addFreshOption(
      "build",
      "build_implementation_start",
      `${params.roleLabelByRole.build} · ${params.scenarioLabels.build_implementation_start}`,
      `Create ${params.roleLabelByRole.build.toLowerCase()} session with ${params.scenarioLabels.build_implementation_start.toLowerCase()}`,
      params.createSessionDisabled,
    );
    if (params.hasQaRejection) {
      addFreshOption(
        "build",
        "build_after_qa_rejected",
        `${params.roleLabelByRole.build} · ${params.scenarioLabels.build_after_qa_rejected}`,
        `Create ${params.roleLabelByRole.build.toLowerCase()} session with ${params.scenarioLabels.build_after_qa_rejected.toLowerCase()}`,
        params.createSessionDisabled,
      );
    }
    if (params.hasHumanFeedback) {
      addFreshOption(
        "build",
        "build_after_human_request_changes",
        `${params.roleLabelByRole.build} · ${params.scenarioLabels.build_after_human_request_changes}`,
        `Create ${params.roleLabelByRole.build.toLowerCase()} session with ${params.scenarioLabels.build_after_human_request_changes.toLowerCase()}`,
        params.createSessionDisabled,
      );
    }
  }

  if (params.roleEnabledByTask.qa) {
    addFreshOption(
      "qa",
      "qa_review",
      `${params.roleLabelByRole.qa} · ${params.scenarioLabels.qa_review}`,
      `Create ${params.roleLabelByRole.qa.toLowerCase()} session with ${params.scenarioLabels.qa_review.toLowerCase()}`,
      params.createSessionDisabled,
    );
  }

  return options;
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
