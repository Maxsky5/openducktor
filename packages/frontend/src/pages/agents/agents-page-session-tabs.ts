import type { AgentWorkflowState, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { AgentStudioTaskTab } from "@/components/features/agents";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { firstLaunchAction, type SessionLaunchActionId } from "@/features/session-start";
import {
  isAgentSessionActivityActive,
  isAgentSessionActivityWorking,
} from "@/lib/agent-session-activity-state";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionOptionSummary,
  buildRoleSessionSequenceByIdentity,
  compareAgentSessionRecency,
  formatAgentSessionOptionDescription,
  formatAgentSessionOptionLabel,
} from "@/lib/agent-session-options";
import { buildRoleWorkflowMapForTask as resolveRoleWorkflowMapForTask } from "@/lib/task-agent-workflows";
import { isQaRejectedTask } from "@/lib/task-qa";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type {
  AgentWorkflowStepAvailability,
  AgentWorkflowStepLiveSession,
  AgentWorkflowStepState,
} from "@/types/agent-workflow";

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
  Pick<AgentSessionSummary, "taskId">;

type WorkflowSessionSummary = AgentSessionWorkflowSummary & {
  role: AgentRole;
};

const isWorkflowSessionSummary = (
  session: AgentSessionWorkflowSummary | null | undefined,
): session is WorkflowSessionSummary => session?.role !== null;

const ALL_AGENT_ROLES: AgentRole[] = ["spec", "planner", "build", "qa"];

type TaskAttentionState = "none" | "blocked_needs_input";

const deriveWorkflowAvailability = (
  workflow: AgentWorkflowState,
): AgentWorkflowStepAvailability => {
  if (workflow.canSkip && workflow.available) {
    return "optional";
  }
  return workflow.available ? "available" : "blocked";
};

const isWorkflowLiveSessionWorking = (liveSession: AgentWorkflowStepLiveSession): boolean =>
  liveSession !== "none" && isAgentSessionActivityWorking(liveSession);

const isWorkflowLiveSessionActive = (liveSession: AgentWorkflowStepLiveSession): boolean =>
  liveSession !== "none" && (isAgentSessionActivityActive(liveSession) || liveSession === "error");

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
  if (isWorkflowLiveSessionWorking(liveSession)) {
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
    !isWorkflowLiveSessionWorking(params.liveSession) &&
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
  liveSessionByRole: Record<AgentRole, AgentWorkflowStepLiveSession>;
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
    const availability = deriveWorkflowAvailability(workflow);
    const liveSession = params.liveSessionByRole[role];
    const isLiveSessionActive = isWorkflowLiveSessionActive(liveSession);
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

export const buildLiveSessionByRoleMap = (
  sessionsForTask: AgentSessionWorkflowSummary[],
): Record<AgentRole, AgentWorkflowStepLiveSession> => {
  const latestSessionByRole = buildLatestSessionByRoleMap(sessionsForTask);

  return createRoleRecord((role) => {
    const latestSession = latestSessionByRole[role];
    return latestSession ? latestSession.activityState : "none";
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
    const roleSessionNumberByIdentity = buildRoleSessionSequenceByIdentity(roleSessions);
    const roleOptions: ComboboxOption[] = roleSessions.map((session, index) => {
      const sessionIdentity = agentSessionIdentityKey(session);
      return {
        value: sessionIdentity,
        label: formatAgentSessionOptionLabel({
          session,
          sessionNumber: roleSessionNumberByIdentity.get(sessionIdentity) ?? index + 1,
          roleLabelByRole: params.roleLabelByRole,
        }),
        description: formatAgentSessionOptionDescription(session),
        searchKeywords: [role, session.externalSessionId],
      };
    });
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

const getTabStatusFromSession = (
  session: AgentSessionWorkflowSummary | null | undefined,
): AgentStudioTaskTab["status"] => {
  if (!session) {
    return "idle";
  }

  const liveSessionState = session.activityState;
  if (liveSessionState === "waiting_input") {
    return "waiting_input";
  }
  if (isAgentSessionActivityWorking(liveSessionState)) {
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
