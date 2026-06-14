import type { AgentWorkflowState, TaskCard } from "@openducktor/contracts";
import { type AgentRole, isRecord } from "@openducktor/core";
import type { AgentStudioTaskTab } from "@/components/features/agents";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { firstLaunchAction, type SessionLaunchActionId } from "@/features/session-start";
import {
  type AgentSessionOptionSummary,
  buildRoleSessionSequenceById,
  compareAgentSessionRecency,
  formatAgentSessionOptionDescription,
  formatAgentSessionOptionLabel,
} from "@/lib/agent-session-options";
import { isAgentSessionWorkingStatus } from "@/lib/agent-session-status";
import { errorMessage } from "@/lib/errors";
import { buildRoleWorkflowMapForTask as resolveRoleWorkflowMapForTask } from "@/lib/task-agent-workflows";
import { isQaRejectedTask } from "@/lib/task-qa";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type {
  AgentWorkflowStepAvailability,
  AgentWorkflowStepLiveSession,
  AgentWorkflowStepState,
} from "@/types/agent-workflow";
import { toTabsStorageKey } from "./agent-studio-navigation";

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
  launchActionId: SessionLaunchActionId;
  label: string;
  description: string;
  disabled: boolean;
  disabledReason?: string;
};

export type AgentSessionWorkflowSummary = AgentSessionOptionSummary &
  Pick<AgentSessionSummary, "taskId" | "pendingApprovals" | "pendingQuestions">;

type WorkflowSessionSummary = AgentSessionWorkflowSummary & {
  role: AgentRole;
};

const isWorkflowSessionSummary = (
  session: AgentSessionWorkflowSummary | null | undefined,
): session is WorkflowSessionSummary => session?.role !== null;

const ALL_AGENT_ROLES: AgentRole[] = ["spec", "planner", "build", "qa"];

const DEFAULT_PERSISTED_TABS_STATE: PersistedTaskTabsState = {
  tabs: [],
  activeTaskId: null,
};

type RoleSessionSummary = {
  latestSession: AgentSessionWorkflowSummary | null;
  workflowSession: AgentSessionWorkflowSummary | null;
  liveSession: AgentWorkflowStepLiveSession;
};

type TaskAttentionState = "none" | "blocked_needs_input";

const toLiveSessionState = (session: AgentSessionWorkflowSummary): AgentWorkflowStepLiveSession => {
  if (session.pendingApprovals.length > 0 || session.pendingQuestions.length > 0) {
    return "waiting_input";
  }
  if (isAgentSessionWorkingStatus(session.status)) {
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

const createRoleRecord = <Value>(build: (role: AgentRole) => Value): Record<AgentRole, Value> => ({
  spec: build("spec"),
  planner: build("planner"),
  build: build("build"),
  qa: build("qa"),
});

const buildSessionsByRole = (
  sessionsForTask: AgentSessionWorkflowSummary[],
): Record<AgentRole, WorkflowSessionSummary[]> => {
  const sessionsByRole = createRoleRecord<WorkflowSessionSummary[]>(() => []);

  for (const session of sessionsForTask.toSorted(compareAgentSessionRecency)) {
    if (!isWorkflowSessionSummary(session)) {
      continue;
    }
    sessionsByRole[session.role].push(session);
  }

  return sessionsByRole;
};

const deriveTaskAttentionState = (task: TaskCard | null | undefined): TaskAttentionState => {
  return task?.status === "blocked" ? "blocked_needs_input" : "none";
};

const deriveTaskTabStatusFromAttentionState = (
  attentionState: TaskAttentionState,
): AgentStudioTaskTab["status"] => {
  return attentionState === "blocked_needs_input" ? "waiting_input" : "idle";
};

const deriveWorkflowToneForRole = (params: {
  role: AgentRole;
  taskAttentionState: TaskAttentionState;
  availability: AgentWorkflowStepAvailability;
  completion: AgentWorkflowStepState["completion"];
  liveSession: AgentWorkflowStepLiveSession;
}): AgentWorkflowStepState["tone"] => {
  const allowBlockedTaskWarning =
    params.role === "build" &&
    params.taskAttentionState === "blocked_needs_input" &&
    params.liveSession !== "running" &&
    params.liveSession !== "error";

  if (allowBlockedTaskWarning) {
    return "waiting_input";
  }

  return deriveWorkflowTone({
    availability: params.availability,
    completion: params.completion,
    liveSession: params.liveSession,
  });
};

export const buildLatestSessionByTaskMap = (
  sessions: AgentSessionWorkflowSummary[],
): Map<string, AgentSessionWorkflowSummary> => {
  const sortedSessions = sessions.toSorted(compareAgentSessionRecency);
  const next = new Map<string, AgentSessionWorkflowSummary>();
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

export const reorderTaskTabs = (params: {
  tabTaskIds: string[];
  draggedTaskId: string;
  targetTaskId: string;
  position: "before" | "after";
}): string[] => {
  const { tabTaskIds, draggedTaskId, targetTaskId, position } = params;
  const sourceIndex = tabTaskIds.indexOf(draggedTaskId);
  const targetIndex = tabTaskIds.indexOf(targetTaskId);

  if (sourceIndex < 0 || targetIndex < 0 || draggedTaskId === targetTaskId) {
    return tabTaskIds;
  }

  const nextTabTaskIds = tabTaskIds.filter((taskId) => taskId !== draggedTaskId);
  const nextTargetIndex = nextTabTaskIds.indexOf(targetTaskId);

  if (nextTargetIndex < 0) {
    return tabTaskIds;
  }

  const insertionIndex = position === "before" ? nextTargetIndex : nextTargetIndex + 1;
  nextTabTaskIds.splice(insertionIndex, 0, draggedTaskId);
  return nextTabTaskIds;
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

export const addTaskToPersistedTaskTabs = (params: {
  raw: string | null;
  taskId: string;
  tasks: TaskCard[];
}): string | null => {
  const taskId = params.taskId.trim();
  if (!taskId) {
    return null;
  }

  const task = params.tasks.find((entry) => entry.id === taskId) ?? null;
  if (!task || task.status === "closed") {
    return null;
  }

  const persisted = parsePersistedTaskTabs(params.raw);
  if (persisted.tabs.includes(taskId)) {
    return toPersistedTaskTabs(persisted);
  }

  return toPersistedTaskTabs({
    tabs: [...persisted.tabs, taskId],
    activeTaskId: persisted.activeTaskId,
  });
};

export const addTaskToPersistedAgentStudioTabs = (params: {
  workspaceId: string;
  taskId: string;
  tasks: TaskCard[];
}): void => {
  const storageKey = toTabsStorageKey(params.workspaceId);
  let raw: string | null;
  try {
    raw = globalThis.localStorage.getItem(storageKey);
  } catch (cause) {
    throw new Error(
      `Failed to read agent studio task tabs storage key "${storageKey}": ${errorMessage(cause)}`,
      { cause },
    );
  }

  const next = addTaskToPersistedTaskTabs({
    raw,
    taskId: params.taskId,
    tasks: params.tasks,
  });
  if (next === null || next === raw) {
    return;
  }

  try {
    globalThis.localStorage.setItem(storageKey, next);
  } catch (cause) {
    throw new Error(
      `Failed to persist agent studio task tabs storage key "${storageKey}": ${errorMessage(cause)}`,
      { cause },
    );
  }
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
  persistenceWorkspaceId: string | null,
  tabsStorageHydratedWorkspaceId: string | null,
): boolean => {
  return (
    Boolean(persistenceWorkspaceId) && tabsStorageHydratedWorkspaceId === persistenceWorkspaceId
  );
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
  const stateByRole = createRoleRecord<AgentWorkflowStepState>(() => ({
    tone: "blocked",
    availability: "blocked",
    completion: "not_started",
    liveSession: "none",
  }));
  const taskAttentionState = deriveTaskAttentionState(params.task);
  const qaRejected = isQaRejectedTask(params.task);
  const taskStatus = params.task?.status;
  const qaApprovedInBuildCompleteStatus =
    params.task?.documentSummary.qaReport.verdict === "approved" &&
    (taskStatus === "ai_review" || taskStatus === "human_review" || taskStatus === "closed");
  const qaRejectedInAiReview =
    params.task &&
    params.task.status === "ai_review" &&
    params.task.documentSummary.qaReport.verdict === "rejected";

  for (const role of ALL_AGENT_ROLES) {
    const workflow = params.roleWorkflowsByTask[role];
    const sessionSummary = params.roleSessionByRole[role];
    const availability = deriveWorkflowAvailability(workflow);
    const liveSession = sessionSummary.liveSession;
    const isLiveSessionActive =
      liveSession === "running" || liveSession === "waiting_input" || liveSession === "error";
    let completion: AgentWorkflowStepState["completion"] = "not_started";

    if (role === "build" && (qaRejected || qaApprovedInBuildCompleteStatus)) {
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

    const tone = deriveWorkflowToneForRole({
      role,
      taskAttentionState,
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
  sessionsForTask: AgentSessionWorkflowSummary[],
): Record<AgentRole, AgentSessionWorkflowSummary | null> => {
  const sessionsByRole = buildSessionsByRole(sessionsForTask);
  return createRoleRecord((role) => sessionsByRole[role][0] ?? null);
};

export const buildRoleSessionSummaryMap = (
  sessionsForTask: AgentSessionWorkflowSummary[],
): Record<AgentRole, RoleSessionSummary> => {
  const latestSessionByRole = buildLatestSessionByRoleMap(sessionsForTask);

  return createRoleRecord((role) => {
    const latestSession = latestSessionByRole[role];
    const workflowSession = latestSession;

    return {
      latestSession,
      workflowSession,
      liveSession: workflowSession ? toLiveSessionState(workflowSession) : "none",
    };
  });
};

export const buildSessionSelectorGroups = (params: {
  sessionsForTask: AgentSessionWorkflowSummary[];
  roleLabelByRole: Record<AgentRole, string>;
}): ComboboxGroup[] => {
  const groups: ComboboxGroup[] = [];
  const sessionsByRole = buildSessionsByRole(params.sessionsForTask);

  for (const role of ALL_AGENT_ROLES) {
    const roleSessions = sessionsByRole[role];
    if (roleSessions.length === 0) {
      continue;
    }
    const roleSessionNumberById = buildRoleSessionSequenceById(roleSessions);
    const roleOptions: ComboboxOption[] = roleSessions.map((session, index) => ({
      value: session.externalSessionId,
      label: formatAgentSessionOptionLabel({
        session,
        sessionNumber: roleSessionNumberById.get(session.externalSessionId) ?? index + 1,
        roleLabelByRole: params.roleLabelByRole,
      }),
      description: formatAgentSessionOptionDescription(session),
      searchKeywords: [role, session.externalSessionId],
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
}): SessionCreateOption[] => {
  const options: SessionCreateOption[] = [];

  const resolveBuildLaunchAction = (): SessionLaunchActionId => {
    if (params.hasHumanFeedback) {
      return "build_after_human_request_changes";
    }
    if (params.hasQaRejection) {
      return "build_after_qa_rejected";
    }
    return "build_implementation_start";
  };

  const addMessageFirstOption = (
    role: AgentRole,
    launchActionId: SessionLaunchActionId,
    description: string,
  ) => {
    options.push({
      id: `${role}:${launchActionId}:message_first`,
      role,
      launchActionId,
      label: `Prepare ${params.roleLabelByRole[role]} session`,
      description,
      disabled: params.createSessionDisabled,
      ...(params.createSessionDisabled
        ? { disabledReason: "Wait for the current session to finish." }
        : {}),
    });
  };

  if (params.roleEnabledByTask.spec) {
    const launchActionId = firstLaunchAction("spec");
    addMessageFirstOption(
      "spec",
      launchActionId,
      "Open a Spec composer without sending a kickoff.",
    );
  }

  if (params.roleEnabledByTask.planner) {
    const launchActionId = firstLaunchAction("planner");
    addMessageFirstOption(
      "planner",
      launchActionId,
      "Open a Planner composer without sending a kickoff.",
    );
  }

  if (params.roleEnabledByTask.build) {
    addMessageFirstOption(
      "build",
      resolveBuildLaunchAction(),
      "Open a Builder composer without sending a kickoff.",
    );
  }

  if (params.roleEnabledByTask.qa) {
    const launchActionId = firstLaunchAction("qa");
    addMessageFirstOption("qa", launchActionId, "Open a QA composer without sending a kickoff.");
  }

  return options;
};

export const getAvailableTabTasks = (tasks: TaskCard[], tabTaskIds: string[]): TaskCard[] => {
  return tasks.filter((task) => !tabTaskIds.includes(task.id));
};

const getTabStatusFromSession = (
  session: AgentSessionWorkflowSummary | null | undefined,
): AgentStudioTaskTab["status"] => {
  if (!session) {
    return "idle";
  }
  if (session.pendingApprovals.length > 0 || session.pendingQuestions.length > 0) {
    return "waiting_input";
  }
  if (isAgentSessionWorkingStatus(session.status)) {
    return "working";
  }
  return "idle";
};

export const getTabStatusForTask = (params: {
  task: TaskCard | null | undefined;
  session: AgentSessionWorkflowSummary | null | undefined;
}): AgentStudioTaskTab["status"] => {
  const attentionState = deriveTaskAttentionState(params.task);

  if (attentionState !== "none") {
    return deriveTaskTabStatusFromAttentionState(attentionState);
  }

  return getTabStatusFromSession(params.session);
};

export const buildTaskTabs = (params: {
  tabTaskIds: string[];
  tasks: TaskCard[];
  latestSessionByTaskId: Map<string, AgentSessionWorkflowSummary>;
  activeTaskId: string;
}): AgentStudioTaskTab[] => {
  const taskById = new Map(params.tasks.map((task) => [task.id, task]));

  return params.tabTaskIds.map((tabTaskId) => {
    const task = taskById.get(tabTaskId);
    const session = params.latestSessionByTaskId.get(tabTaskId);

    return {
      taskId: tabTaskId,
      taskTitle: task?.title ?? tabTaskId,
      status: getTabStatusForTask({
        task,
        session,
      }),
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
