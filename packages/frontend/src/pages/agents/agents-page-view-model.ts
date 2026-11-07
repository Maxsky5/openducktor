import { toAgentWorkflowStep } from "@/components/features/agents/agent-workflow-step";
import {
  type WorkflowRoleId as AgentRole,
  type ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";
import type { WorkflowRailStep } from "@openducktor/frontend-core/tasks/presentation/workflow-rail";
import type { AgentRoleOption, AgentStudioHeaderModel } from "@/components/features/agents";
import type { ComboboxGroup } from "@/components/ui/combobox";
import type { AgentStudioQuickActionOption } from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import type { AgentSessionWorkflowSummary, SessionCreateOption } from "./agents-page-session-tabs";

export const buildRoleLabelByRole = (roleOptions: AgentRoleOption[]): Record<AgentRole, string> => {
  return Object.fromEntries(roleOptions.map(({ role, label }) => [role, label]));
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
  workflowRail: WorkflowRailStep<string>[];
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
  workflowSteps: args.workflowRail.map(toAgentWorkflowStep),
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
