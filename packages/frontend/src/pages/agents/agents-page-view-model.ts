import type { WorkflowStepPresentation } from "@openducktor/frontend-core/types/agent-workflow";
import {
  BUILTIN_ROLE_LABELS,
  BUILTIN_STEPS,
  type BuiltinRoleId as AgentRole,
  type BuiltinTaskCard as TaskCard,
} from "@openducktor/workflows";
import { workflowStepRailState } from "@openducktor/frontend-core/lib/agent-workflow-state";
import type { AgentRoleOption, AgentStudioHeaderModel } from "@/components/features/agents";
import type { ComboboxGroup } from "@/components/ui/combobox";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import type { AgentStudioQuickActionOption } from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import type { AgentSessionWorkflowSummary, SessionCreateOption } from "./agents-page-session-tabs";

export const buildRoleLabelByRole = (roleOptions: AgentRoleOption[]): Record<AgentRole, string> => {
  return roleOptions.reduce(
    (acc, entry) => {
      acc[entry.role] = entry.label;
      return acc;
    },
    { ...BUILTIN_ROLE_LABELS },
  );
};

/** The chat header model without the git conflict handler, which the page shell adds. */
export type AgentStudioWorkflowHeaderModel = Omit<
  AgentStudioHeaderModel,
  "onResolveGitConflictQuickAction"
>;

export const buildAgentStudioHeaderModel = (args: {
  selectedTask: TaskCard | null;
  onOpenTaskDetails: (() => void) | null;
  roleOptions: AgentRoleOption[];
  workflowStateByRole: Record<AgentRole, WorkflowStepPresentation>;
  selectedRole: AgentRole | null;
  workflowSessionByRole: Record<AgentRole, AgentSessionWorkflowSummary | null>;
  onWorkflowStepSelect: (role: AgentRole, sessionValue: string | null) => void;
  onSessionSelectionChange: (value: string) => void;
  sessionSelectorAutofocusByValue: Record<string, boolean>;
  sessionSelectorValue: string;
  sessionSelectorGroups: ComboboxGroup[];
  agentStudioReady: boolean;
  sessionsForTaskLength: number;
  sessionCreateOptions: SessionCreateOption[];
  onPrepareMessageFirstSession: (option: SessionCreateOption) => void;
  quickActions: AgentStudioQuickActionOption[];
  primaryQuickAction: AgentStudioQuickActionOption | null;
  onQuickAction: (option: AgentStudioQuickActionOption) => void;
  isStarting: boolean;
}): AgentStudioWorkflowHeaderModel => ({
  taskTitle: args.selectedTask?.title ?? null,
  taskId: args.selectedTask?.id ?? null,
  pullRequest: args.selectedTask?.pullRequest ?? null,
  onOpenTaskDetails: args.selectedTask ? args.onOpenTaskDetails : null,
  selectedRole: args.selectedRole,
  workflowSteps: BUILTIN_STEPS.flatMap((step) => {
    const roleOption = args.roleOptions.find((option) => option.role === step.roleId);
    if (!roleOption) return [];
    const workflowSession = args.workflowSessionByRole[step.roleId];
    const entry = {
      id: step.id,
      role: step.roleId,
      label: step.label,
      icon: roleOption.icon,
      state: args.workflowStateByRole[step.roleId],
      sessionValue: workflowSession ? agentSessionIdentityKey(workflowSession) : null,
    };
    return [{ ...entry, ...workflowStepRailState(entry) }];
  }),
  onWorkflowStepSelect: args.onWorkflowStepSelect,
  sessionSelector: {
    value: args.sessionSelectorValue,
    groups: args.sessionSelectorGroups,
    disabled: !args.agentStudioReady || args.sessionsForTaskLength === 0,
    onValueChange: args.onSessionSelectionChange,
    shouldAutofocusComposerForValue: (value) =>
      args.sessionSelectorAutofocusByValue[value] ?? false,
  },
  sessionCreateOptions: args.sessionCreateOptions,
  onPrepareMessageFirstSession: args.onPrepareMessageFirstSession,
  quickActions: args.quickActions,
  primaryQuickAction: args.primaryQuickAction,
  onQuickAction: args.onQuickAction,
  isCreatingSession: args.isStarting,
  agentStudioReady: args.agentStudioReady,
});
