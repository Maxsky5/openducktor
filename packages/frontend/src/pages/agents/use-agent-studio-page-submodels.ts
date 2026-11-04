import type { SessionCreateOption } from "./agents-page-session-tabs";
import { useMemo } from "react";
import type { AgentStudioQuickActionOption } from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import { roleOptionsForTask } from "@/lib/agent-role-presentation";
import { buildAgentStudioHeaderModel } from "./agents-page-view-model";
import type {
  AgentStudioWorkflowStepSelect,
  WorkflowHeaderContext,
} from "./use-agent-studio-page-submodel-contracts";
import type {
  WorkflowRoleId as AgentRole,
  ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";

type UseAgentStudioHeaderModelArgs = {
  selectedTask: TaskCard | null;
  onOpenTaskDetails: (() => void) | null;
  selectedRole: AgentRole | null;
  sessionsForTaskLength: number;
  agentStudioReady: boolean;
  isStarting: boolean;
  onWorkflowStepSelect: AgentStudioWorkflowStepSelect;
  onSessionSelectionChange: (nextValue: string) => void;
  onPrepareMessageFirstSession: (option: SessionCreateOption) => void;
  onQuickAction: (option: AgentStudioQuickActionOption) => void;
  workflow: WorkflowHeaderContext;
};

export const useAgentStudioHeaderModel = ({
  selectedTask,
  onOpenTaskDetails,
  selectedRole,
  sessionsForTaskLength,
  agentStudioReady,
  isStarting,
  onWorkflowStepSelect,
  onSessionSelectionChange,
  onPrepareMessageFirstSession,
  onQuickAction,
  workflow,
}: UseAgentStudioHeaderModelArgs): ReturnType<typeof buildAgentStudioHeaderModel> => {
  return useMemo(
    () =>
      buildAgentStudioHeaderModel({
        selectedTask,
        onOpenTaskDetails,
        roleOptions: roleOptionsForTask(selectedTask),
        workflowRail: workflow.workflowRail,
        selectedRole,
        workflowSessionByRole: workflow.workflowSessionByRole,
        sessionSelectorAutofocusByValue: workflow.sessionSelectorAutofocusByValue,
        onWorkflowStepSelect,
        onSessionSelectionChange,
        sessionSelectorValue: workflow.sessionSelectorValue,
        sessionSelectorGroups: workflow.sessionSelectorGroups,
        agentStudioReady,
        sessionsForTaskLength,
        sessionCreateOptions: workflow.sessionCreateOptions,
        onPrepareMessageFirstSession,
        quickActions: workflow.quickActions,
        primaryQuickAction: workflow.primaryQuickAction,
        onQuickAction,
        isStarting,
      }),
    [
      agentStudioReady,
      isStarting,
      onOpenTaskDetails,
      onPrepareMessageFirstSession,
      onQuickAction,
      onSessionSelectionChange,
      onWorkflowStepSelect,
      selectedRole,
      selectedTask,
      sessionsForTaskLength,
      workflow.primaryQuickAction,
      workflow.quickActions,
      workflow.sessionSelectorAutofocusByValue,
      workflow.sessionCreateOptions,
      workflow.sessionSelectorGroups,
      workflow.sessionSelectorValue,
      workflow.workflowSessionByRole,
      workflow.workflowRail,
    ],
  );
};
