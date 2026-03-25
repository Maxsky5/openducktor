import type { AgentWorkflowState, TaskCard } from "@openducktor/contracts";
import {
  type AgentRole,
  type AgentScenario,
  isRecord,
  isScenarioStartModeAllowed,
} from "@openducktor/core";
import type { AgentStudioTaskTab } from "@/components/features/agents";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import {
  buildRoleSessionSequenceById,
  compareAgentSessionRecency,
  formatAgentSessionOptionDescription,
  formatAgentSessionOptionLabel,
} from "@/lib/agent-session-options";
import { buildRoleWorkflowMapForTask as resolveRoleWorkflowMapForTask } from "@/lib/task-agent-workflows";
import { isQaRejectedTask } from "@/lib/task-qa";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type {
  AgentWorkflowStepAvailability,
  AgentWorkflowStepLiveSession,
  AgentWorkflowStepState,
} from "@/types/agent-workflow";

type PersistedTaskTabsPayload = {
  tabs: string[];
  activeTaskId?: string | null;
};

type PersistedTaskTabsState = {
  tabs: string[];
  activeTaskId: string | null;
};

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

type RoleSessionSummary = {
  latestSession: AgentSessionState | null;
  workflowSession: AgentSessionState | null;
  liveSession: AgentWorkflowStepLiveSession;
};

const toLiveSessionState = (session: AgentSessionState): AgentWorkflowStepLiveSession => {
  if (session.pendingPermissions.length > 0 || session.pendingQuestions.length > 0) {
    return "waiting_input";
  }
  if (session.status === "starting" || session.status === "running") {
    return "running";
  }
  if (session.status === "error") {
    return "error";
  }
  if (session.status === "stopped") {
    return "stopped";
  }
  return "idle";
};

const deriveWorkflowAvailability = (
  workflow: AgentWorkflowState,
): AgentWorkflowStepAvailability => {
  if (workflow.canSkip && workflow.available) {
    return "optional";
  }
  return workflow.available ? "available" : "blocked";
};

const deriveWorkflowTone = (params: {
  availability: AgentWorkflowStepAvailability;
  completion: AgentWorkflowStepState["completion"];
  liveSession: AgentWorkflowStepLiveSession;
}): AgentWorkflowStepState["tone"] => {
  const { availability, completion, liveSession } = params;

  if (completion === "rejected") {
    return "rejected";
  }
  if (liveSession === "waiting_input") {
    return "waiting_input";
  }
  if (liveSession === "running") {
    return "in_progress";
  }
  if (liveSession === "error") {
    return "failed";
  }
  if (completion === "done") {
    return "done";
  }
  if (completion === "in_progress") {
    return "in_progress";
  }
  return availability;
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
  const sortedSessions = [...sessions].sort(compareAgentSessionRecency);
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
  roleSessionByRole: Record<AgentRole, RoleSessionSummary>;
}): Record<AgentRole, AgentWorkflowStepState> => {
  const stateByRole: Record<AgentRole, AgentWorkflowStepState> = {
    spec: {
      tone: "blocked",
      availability: "blocked",
      completion: "not_started",
      liveSession: "none",
    },
    planner: {
      tone: "blocked",
      availability: "blocked",
      completion: "not_started",
      liveSession: "none",
    },
    build: {
      tone: "blocked",
      availability: "blocked",
      completion: "not_started",
      liveSession: "none",
    },
    qa: {
      tone: "blocked",
      availability: "blocked",
      completion: "not_started",
      liveSession: "none",
    },
  };
  const qaRejected = isQaRejectedTask(params.task);
  const qaRejectedInAiReview =
    params.task &&
    params.task.status === "ai_review" &&
    params.task.documentSummary.qaReport.verdict === "rejected";

  for (const role of ALL_AGENT_ROLES) {
    const workflow = params.roleWorkflowsByTask[role];
    const sessionSummary = params.roleSessionByRole[role];
    const availability = deriveWorkflowAvailability(workflow);
    const latestRoleSession = sessionSummary.latestSession;
    const liveSession = sessionSummary.liveSession;
    const isLiveSessionActive =
      liveSession === "running" || liveSession === "waiting_input" || liveSession === "error";
    let completion: AgentWorkflowStepState["completion"] = "not_started";

    if (role === "build" && qaRejected) {
      completion = "done";
    } else if (
      role === "build" &&
      latestRoleSession?.scenario === "build_after_qa_rejected" &&
      (latestRoleSession.status === "idle" || latestRoleSession.status === "stopped") &&
      params.roleWorkflowsByTask.qa.completed &&
      !qaRejected
    ) {
      completion = "done";
    } else if (role === "qa" && qaRejected) {
      completion = "rejected";
    } else if (role === "qa" && qaRejectedInAiReview && !isLiveSessionActive) {
      completion = "rejected";
    } else if (workflow.completed) {
      completion = "done";
    } else if (
      isLiveSessionActive ||
      (liveSession === "idle" && workflow.available) ||
      (role === "build" && liveSession === "stopped" && workflow.available)
    ) {
      completion = "in_progress";
    }

    const tone = deriveWorkflowTone({
      availability,
      completion,
      liveSession,
    });

    stateByRole[role] = {
      tone,
      availability,
      completion,
      liveSession,
    };
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

  const sortedSessions = [...sessionsForTask].sort(compareAgentSessionRecency);

  for (const role of ALL_AGENT_ROLES) {
    map[role] = sortedSessions.find((entry) => entry.role === role) ?? null;
  }

  return map;
};

export const buildRoleSessionSummaryMap = (
  sessionsForTask: AgentSessionState[],
): Record<AgentRole, RoleSessionSummary> => {
  const sortedSessions = [...sessionsForTask].sort(compareAgentSessionRecency);
  const map: Record<AgentRole, RoleSessionSummary> = {
    spec: {
      latestSession: null,
      workflowSession: null,
      liveSession: "none",
    },
    planner: {
      latestSession: null,
      workflowSession: null,
      liveSession: "none",
    },
    build: {
      latestSession: null,
      workflowSession: null,
      liveSession: "none",
    },
    qa: {
      latestSession: null,
      workflowSession: null,
      liveSession: "none",
    },
  };

  for (const role of ALL_AGENT_ROLES) {
    const roleSessions = sortedSessions.filter((entry) => entry.role === role);
    const latestSession = roleSessions[0] ?? null;
    const workflowSession = latestSession;

    map[role] = {
      latestSession,
      workflowSession,
      liveSession: workflowSession ? toLiveSessionState(workflowSession) : "none",
    };
  }

  return map;
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
    const roleSessionNumberById = buildRoleSessionSequenceById(roleSessions);
    const roleOptions: ComboboxOption[] = roleSessions.map((session, index) => ({
      value: session.sessionId,
      label: formatAgentSessionOptionLabel({
        session,
        sessionNumber: roleSessionNumberById.get(session.sessionId) ?? index + 1,
        scenarioLabels: params.scenarioLabels,
        roleLabelByRole: params.roleLabelByRole,
      }),
      description: formatAgentSessionOptionDescription(session),
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
    if (isScenarioStartModeAllowed("spec_initial", "fresh")) {
      addFreshOption(
        "spec",
        "spec_initial",
        `${params.roleLabelByRole.spec} · Start Spec`,
        "Create a new spec session from scratch",
        params.createSessionDisabled,
      );
    }
  }

  const canStartPlannerFresh = params.roleEnabledByTask.planner;
  if (canStartPlannerFresh) {
    if (isScenarioStartModeAllowed("planner_initial", "fresh")) {
      addFreshOption(
        "planner",
        "planner_initial",
        `${params.roleLabelByRole.planner} · Start Planner`,
        "Create a new planner session from scratch",
        params.createSessionDisabled,
      );
    }
  }

  if (params.roleEnabledByTask.build) {
    if (isScenarioStartModeAllowed("build_implementation_start", "fresh")) {
      addFreshOption(
        "build",
        "build_implementation_start",
        `${params.roleLabelByRole.build} · ${params.scenarioLabels.build_implementation_start}`,
        `Create ${params.roleLabelByRole.build.toLowerCase()} session with ${params.scenarioLabels.build_implementation_start.toLowerCase()}`,
        params.createSessionDisabled,
      );
    }
    if (params.hasQaRejection) {
      if (isScenarioStartModeAllowed("build_after_qa_rejected", "fresh")) {
        addFreshOption(
          "build",
          "build_after_qa_rejected",
          `${params.roleLabelByRole.build} · ${params.scenarioLabels.build_after_qa_rejected}`,
          `Create ${params.roleLabelByRole.build.toLowerCase()} session with ${params.scenarioLabels.build_after_qa_rejected.toLowerCase()}`,
          params.createSessionDisabled,
        );
      }
    }
    if (params.hasHumanFeedback) {
      if (isScenarioStartModeAllowed("build_after_human_request_changes", "fresh")) {
        addFreshOption(
          "build",
          "build_after_human_request_changes",
          `${params.roleLabelByRole.build} · ${params.scenarioLabels.build_after_human_request_changes}`,
          `Create ${params.roleLabelByRole.build.toLowerCase()} session with ${params.scenarioLabels.build_after_human_request_changes.toLowerCase()}`,
          params.createSessionDisabled,
        );
      }
    }
  }

  if (params.roleEnabledByTask.qa) {
    if (isScenarioStartModeAllowed("qa_review", "fresh")) {
      addFreshOption(
        "qa",
        "qa_review",
        `${params.roleLabelByRole.qa} · ${params.scenarioLabels.qa_review}`,
        `Create ${params.roleLabelByRole.qa.toLowerCase()} session with ${params.scenarioLabels.qa_review.toLowerCase()}`,
        params.createSessionDisabled,
      );
    }
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
