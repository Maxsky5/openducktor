import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useMemo } from "react";
import type { AgentStudioQuickActionOption } from "./agent-studio-quick-actions";
import { ROLE_OPTIONS } from "./agents-page-constants";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import { buildAgentStudioHeaderModel } from "./agents-page-view-model";
import type {
  AgentStudioWorkflowStepSelect,
  WorkflowHeaderContext,
} from "./use-agent-studio-page-submodel-contracts";

type UseAgentStudioHeaderModelArgs = {
  selectedTask: TaskCard | null;
  onOpenTaskDetails: (() => void) | null;
  selectedRole: AgentRole;
  sessionsForTaskLength: number;
  agentStudioReady: boolean;
  isStarting: boolean;
  onWorkflowStepSelect: AgentStudioWorkflowStepSelect;
  onSessionSelectionChange: (nextValue: string) => void;
  onPrepareMessageFirstSession: (option: SessionCreateOption) => void;
  onQuickAction: (option: AgentStudioQuickActionOption) => void;
  onResolveGitConflictQuickAction?: (() => void) | null;
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
  onResolveGitConflictQuickAction,
  workflow,
}: UseAgentStudioHeaderModelArgs): ReturnType<typeof buildAgentStudioHeaderModel> => {
  return useMemo(
    () =>
      buildAgentStudioHeaderModel({
        selectedTask,
        onOpenTaskDetails,
        roleOptions: ROLE_OPTIONS,
        workflowStateByRole: workflow.workflowStateByRole,
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
        onResolveGitConflictQuickAction: onResolveGitConflictQuickAction ?? null,
        isStarting,
      }),
    [
      agentStudioReady,
      isStarting,
      onOpenTaskDetails,
      onPrepareMessageFirstSession,
      onQuickAction,
      onResolveGitConflictQuickAction,
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
      workflow.workflowStateByRole,
    ],
  );
};
