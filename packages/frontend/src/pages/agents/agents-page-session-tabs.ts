import type { AgentWorkflowState, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { firstLaunchAction, type SessionLaunchActionId } from "@/features/session-start";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import {
  type AgentSessionOptionSummary,
  buildRoleSessionSequenceByIdentity,
  compareAgentSessionRecency,
  formatAgentSessionOptionDescription,
  formatAgentSessionOptionLabel,
} from "@/lib/agent-session-options";
import { buildRoleWorkflowMapForTask as resolveRoleWorkflowMapForTask } from "@/lib/task-agent-workflows";
import { buildRoleWorkflowState } from "@/lib/agent-workflow-state";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentWorkflowStepLiveSession, AgentWorkflowStepState } from "@/types/agent-workflow";

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

const createRoleRecord = <Value>(build: (role: AgentRole) => Value) =>
  ({
    spec: build("spec"),
    planner: build("planner"),
    build: build("build"),
    qa: build("qa"),
  }) satisfies Record<AgentRole, Value>;

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

export const buildRoleEnabledMapForTask = (task: TaskCard | null) => {
  const workflowsByRole = resolveRoleWorkflowMapForTask(task);
  return {
    spec: workflowsByRole.spec.available,
    planner: workflowsByRole.planner.available,
    build: workflowsByRole.build.available,
    qa: workflowsByRole.qa.available,
  } satisfies Record<AgentRole, boolean>;
};

export const buildWorkflowStateByRole = (params: {
  task: TaskCard | null;
  roleWorkflowsByTask: Record<AgentRole, AgentWorkflowState>;
  liveSessionByRole: Record<AgentRole, AgentWorkflowStepLiveSession>;
}): Record<AgentRole, AgentWorkflowStepState> =>
  createRoleRecord((role) =>
    buildRoleWorkflowState({
      task: params.task,
      role,
      workflow: params.roleWorkflowsByTask[role],
      liveSession: params.liveSessionByRole[role],
    }),
  );

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
    const option: SessionCreateOption = {
      id: `${role}:${launchActionId}:message_first`,
      role,
      launchActionId,
      label: `Prepare ${params.roleLabelByRole[role]} session`,
      description,
      disabled: params.createSessionDisabled,
    };
    if (params.createSessionDisabled) {
      option.disabledReason = "Wait for the current session to finish.";
    }
    options.push(option);
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
