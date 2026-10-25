import {
  BUILTIN_ROLE_LABELS,
  BUILTIN_ROLE_IDS,
  recordBy,
  resolveSessionContinuationLaunchAction,
  type BuiltinLaunchActionId as SessionLaunchActionId,
  type BuiltinRoleId as AgentRole,
  type BuiltinTaskCard as TaskCard,
} from "@openducktor/workflows";
import type { AgentWorkflowState } from "@openducktor/contracts";
import type { ComboboxGroup, ComboboxOption } from "@/components/ui/combobox";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import {
  type AgentSessionOptionSummary,
  buildRoleSessionSequenceByIdentity,
  compareAgentSessionRecency,
  formatAgentSessionOptionDescription,
  formatAgentSessionOptionLabel,
} from "@openducktor/frontend-core/lib/agent-session-options";
import { buildRoleWorkflowState } from "@openducktor/frontend-core/lib/agent-workflow-state";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import type {
  WorkflowStepLiveSession,
  WorkflowStepPresentation,
} from "@openducktor/frontend-core/types/agent-workflow";
import { SESSION_BUSY_REASON } from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";

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

const createRoleRecord = <Value>(build: (role: AgentRole) => Value) =>
  recordBy(BUILTIN_ROLE_IDS, build);

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

export const buildWorkflowStateByRole = (params: {
  task: TaskCard | null;
  roleWorkflowsByTask: Record<AgentRole, AgentWorkflowState>;
  liveSessionByRole: Record<AgentRole, WorkflowStepLiveSession>;
}): Record<AgentRole, WorkflowStepPresentation> =>
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
): Record<AgentRole, WorkflowStepLiveSession> => {
  const latestSessionByRole = buildLatestSessionByRoleMap(sessionsForTask);

  return createRoleRecord((role) => {
    const latestSession = latestSessionByRole[role];
    if (!latestSession) return "none";
    if (
      latestSession.statusUnavailableReason &&
      latestSession.activityState !== "waiting_input" &&
      latestSession.activityState !== "error"
    )
      return "none";
    return latestSession.activityState;
  });
};

export const buildSessionSelectorGroups = (params: {
  sessionsForTask: AgentSessionWorkflowSummary[];
  roleLabelByRole: Record<AgentRole, string>;
}): ComboboxGroup[] => {
  const groups: ComboboxGroup[] = [];
  const sessionsByRole = buildSessionsByRole(params.sessionsForTask);

  for (const role of BUILTIN_ROLE_IDS) {
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
  task: TaskCard | null;
  roleEnabledByTask: Record<AgentRole, boolean>;
  createSessionDisabled: boolean;
  roleLabelByRole: Record<AgentRole, string>;
}): SessionCreateOption[] =>
  BUILTIN_ROLE_IDS.filter((role) => params.roleEnabledByTask[role]).map((role) => {
    const launchActionId = resolveSessionContinuationLaunchAction(role, params.task);
    const option: SessionCreateOption = {
      id: `${role}:${launchActionId}:message_first`,
      role,
      launchActionId,
      label: `Prepare ${params.roleLabelByRole[role]} session`,
      description: `Open a ${BUILTIN_ROLE_LABELS[role]} composer without sending a kickoff.`,
      disabled: params.createSessionDisabled,
    };
    if (params.createSessionDisabled) {
      option.disabledReason = SESSION_BUSY_REASON;
    }
    return option;
  });
