import {
  buildWorkflowRail,
  type WorkflowRailStep,
} from "@openducktor/frontend-core/tasks/presentation/workflow-rail";
import {
  buildRoleWorkflowMapForTask,
  type WorkflowRoleId as AgentRole,
  type ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";
import type { RepositoryGitProviderContext } from "@openducktor/contracts";
import type { ComboboxGroup } from "@/components/ui/combobox";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import {
  type AgentStudioQuickActionOption,
  type AgentStudioSessionQuickActionOption,
  buildAgentStudioQuickActions,
  buildGitConflictQuickAction,
  buildRoleEnabledMapForTask,
  selectPrimaryAgentStudioQuickAction,
} from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import {
  type AgentSessionWorkflowSummary,
  buildLatestSessionByRoleMap,
  buildLiveSessionByRoleMap,
  buildSessionCreateOptions,
  buildSessionSelectorGroups,
} from "./agents-page-session-tabs";

export type AgentStudioSessionContextUsage = {
  totalTokens: number;
  contextWindow: number;
  outputLimit?: number;
} | null;

type BuildWorkflowModelContextArgs = {
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  selectedSessionIdentity: AgentSessionIdentity | null;
  role: AgentRole | null;
  isSessionWorking: boolean;
  roleLabelByRole: Record<AgentRole, string>;
  gitProviderContext?: RepositoryGitProviderContext | undefined;
  gitProviderReadError?: string | null;
  /** The target that the task branch is merged into. */
  mergedTarget?: string | null;
};

export type WorkflowModelContext = {
  workflowSessionByRole: Record<AgentRole, AgentSessionWorkflowSummary | null>;
  /** The workflow rail. Each role shows its latest session. */
  workflowRail: WorkflowRailStep<string>[];
  sessionSelectorGroups: ComboboxGroup[];
  sessionSelectorAutofocusByValue: Record<string, boolean>;
  sessionSelectorValue: string;
  sessionCreateOptions: ReturnType<typeof buildSessionCreateOptions>;
  quickActions: AgentStudioQuickActionOption[];
  primaryQuickAction: AgentStudioQuickActionOption | null;
  /** Shown first while the git actions report an active conflict. */
  gitConflictQuickAction: AgentStudioSessionQuickActionOption | null;
  selectedRoleAvailable: boolean;
  selectedRoleReadOnlyReason: string | null;
  createSessionDisabled: boolean;
};

export const buildWorkflowModelContext = ({
  selectedTask,
  sessionsForTask,
  selectedSessionIdentity,
  role,
  isSessionWorking,
  roleLabelByRole,
  gitProviderContext,
  gitProviderReadError = null,
  mergedTarget = null,
}: BuildWorkflowModelContextArgs): WorkflowModelContext => {
  const roleEnabledByTask = buildRoleEnabledMapForTask(selectedTask);
  const roleWorkflowsByTask = buildRoleWorkflowMapForTask(selectedTask);
  const workflowSessionByRole = buildLatestSessionByRoleMap(sessionsForTask);
  const liveSessionByRole = buildLiveSessionByRoleMap(sessionsForTask);
  const workflowRail = selectedTask
    ? buildWorkflowRail(selectedTask, (workflowRole) => {
        const session = workflowSessionByRole[workflowRole] ?? null;
        return {
          session: session ? agentSessionIdentityKey(session) : null,
          liveSession: liveSessionByRole[workflowRole] ?? "none",
        };
      })
    : [];
  const selectedRoleAvailable = role !== null && roleWorkflowsByTask[role]?.available === true;
  const selectedRoleReadOnlyReason = selectedRoleAvailable
    ? null
    : role
      ? `${roleLabelByRole[role]} is unavailable for this task right now.`
      : "This workflow step does not start an agent session.";
  const sessionSelectorGroups = buildSessionSelectorGroups({
    sessionsForTask,
    roleLabelByRole,
  });
  const sessionSelectorAutofocusByValue = Object.fromEntries(
    sessionsForTask.map((session) => [
      agentSessionIdentityKey(session),
      roleWorkflowsByTask[session.role]?.available === true &&
        session.activityState !== "waiting_input",
    ]),
  );
  const sessionSelectorValue = selectedSessionIdentity
    ? agentSessionIdentityKey(selectedSessionIdentity)
    : "";
  const createSessionDisabled = Boolean(selectedSessionIdentity && isSessionWorking);
  const sessionCreateOptions = buildSessionCreateOptions({
    task: selectedTask,
    roleEnabledByTask,
    createSessionDisabled,
    roleLabelByRole,
  });
  const quickActions = buildAgentStudioQuickActions({
    selectedTask,
    sessionsForTask,
    roleEnabledByTask,
    createSessionDisabled,
    gitProviderContext,
    gitProviderReadError,
    mergedTarget,
  });

  return {
    workflowSessionByRole,
    workflowRail,
    sessionSelectorGroups,
    sessionSelectorAutofocusByValue,
    sessionSelectorValue,
    sessionCreateOptions,
    quickActions,
    primaryQuickAction: selectPrimaryAgentStudioQuickAction(quickActions),
    gitConflictQuickAction: buildGitConflictQuickAction({
      selectedTask,
      roleEnabledByTask,
      createSessionDisabled,
    }),
    selectedRoleAvailable,
    selectedRoleReadOnlyReason,
    createSessionDisabled,
  };
};
