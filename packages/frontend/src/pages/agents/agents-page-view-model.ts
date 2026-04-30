import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type {
  AgentRoleOption,
  AgentStudioHeaderModel,
  AgentStudioTaskTabsModel,
  AgentStudioWorkspaceDocument,
  AgentStudioWorkspaceSidebarModel,
} from "@/components/features/agents";
import type { ComboboxGroup } from "@/components/ui/combobox";
import { AGENT_ROLE_LABELS } from "@/types";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentWorkflowStepState } from "@/types/agent-workflow";
import type { AgentSessionWorkflowSummary, SessionCreateOption } from "./agents-page-session-tabs";

export const buildRoleLabelByRole = (roleOptions: AgentRoleOption[]): Record<AgentRole, string> => {
  return roleOptions.reduce(
    (acc, entry) => {
      acc[entry.role] = entry.label;
      return acc;
    },
    { ...AGENT_ROLE_LABELS },
  );
};

export const buildAgentStudioTaskTabsModel = (args: {
  taskTabs: AgentStudioTaskTabsModel["tabs"];
  availableTabTasks: TaskCard[];
  isLoadingTasks: boolean;
  onSelectTab: (taskId: string) => void;
  onCreateTab: (taskId: string) => void;
  onCloseTab: (taskId: string) => void;
  onReorderTab: (draggedTaskId: string, targetTaskId: string, position: "before" | "after") => void;
  agentStudioReady: boolean;
}): AgentStudioTaskTabsModel => ({
  tabs: args.taskTabs,
  availableTabTasks: args.availableTabTasks,
  isLoadingAvailableTabTasks: args.isLoadingTasks,
  onSelectTab: args.onSelectTab,
  onCreateTab: args.onCreateTab,
  onCloseTab: args.onCloseTab,
  onReorderTab: args.onReorderTab,
  agentStudioReady: args.agentStudioReady,
});

export const buildAgentStudioHeaderModel = (args: {
  selectedTask: TaskCard | null;
  onOpenTaskDetails: (() => void) | null;
  activeSession: Pick<AgentSessionState, "status"> | null;
  roleOptions: AgentRoleOption[];
  workflowStateByRole: Record<AgentRole, AgentWorkflowStepState>;
  selectedRole: AgentRole | null;
  workflowSessionByRole: Record<AgentRole, AgentSessionWorkflowSummary | null>;
  onWorkflowStepSelect: (role: AgentRole, externalSessionId: string | null) => void;
  onSessionSelectionChange: (value: string) => void;
  sessionSelectorAutofocusByValue: Record<string, boolean>;
  sessionSelectorValue: string;
  sessionSelectorGroups: ComboboxGroup[];
  agentStudioReady: boolean;
  sessionsForTaskLength: number;
  sessionCreateOptions: SessionCreateOption[];
  onCreateSession: (option: SessionCreateOption) => void;
  createSessionDisabled: boolean;
  isStarting: boolean;
  contextSessionsLength: number;
}): AgentStudioHeaderModel => ({
  taskTitle: args.selectedTask?.title ?? null,
  taskId: args.selectedTask?.id ?? null,
  onOpenTaskDetails: args.selectedTask ? args.onOpenTaskDetails : null,
  sessionStatus: args.activeSession?.status ?? null,
  selectedRole: args.selectedRole,
  workflowSteps: args.roleOptions.map((entry) => {
    const workflowSession = args.workflowSessionByRole[entry.role];
    return {
      role: entry.role,
      label: entry.label,
      icon: entry.icon,
      state: args.workflowStateByRole[entry.role],
      externalSessionId: workflowSession?.externalSessionId ?? null,
    };
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
  onCreateSession: args.onCreateSession,
  createSessionDisabled: args.createSessionDisabled,
  isCreatingSession: args.isStarting,
  agentStudioReady: args.agentStudioReady,
});

export const buildAgentStudioWorkspaceSidebarModel = (args: {
  activeDocument: AgentStudioWorkspaceDocument | null;
}): AgentStudioWorkspaceSidebarModel => ({
  activeDocument: args.activeDocument,
});
