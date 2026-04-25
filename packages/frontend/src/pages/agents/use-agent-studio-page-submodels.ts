import type { TaskCard } from "@openducktor/contracts";
import { useMemo } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
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
  activeSession: Pick<AgentSessionState, "status"> | null;
  sessionsForTaskLength: number;
  contextSessionsLength: number;
  agentStudioReady: boolean;
  isStarting: boolean;
  onWorkflowStepSelect: AgentStudioWorkflowStepSelect;
  onSessionSelectionChange: (nextValue: string) => void;
  onCreateSession: (option: SessionCreateOption) => void;
  workflow: WorkflowHeaderContext;
};

export const useAgentStudioHeaderModel = ({
  selectedTask,
  onOpenTaskDetails,
  activeSession,
  sessionsForTaskLength,
  contextSessionsLength,
  agentStudioReady,
  isStarting,
  onWorkflowStepSelect,
  onSessionSelectionChange,
  onCreateSession,
  workflow,
}: UseAgentStudioHeaderModelArgs): ReturnType<typeof buildAgentStudioHeaderModel> => {
  const activeSessionStatus = activeSession?.status ?? null;

  return useMemo(
    () =>
      buildAgentStudioHeaderModel({
        selectedTask,
        onOpenTaskDetails,
        activeSession: activeSessionStatus ? { status: activeSessionStatus } : null,
        roleOptions: ROLE_OPTIONS,
        workflowStateByRole: workflow.workflowStateByRole,
        selectedRole: workflow.selectedInteractionRole,
        workflowSessionByRole: workflow.workflowSessionByRole,
        sessionSelectorAutofocusByValue: workflow.sessionSelectorAutofocusByValue,
        onWorkflowStepSelect,
        onSessionSelectionChange,
        sessionSelectorValue: workflow.sessionSelectorValue,
        sessionSelectorGroups: workflow.sessionSelectorGroups,
        agentStudioReady,
        sessionsForTaskLength,
        sessionCreateOptions: workflow.sessionCreateOptions,
        onCreateSession,
        createSessionDisabled: workflow.createSessionDisabled,
        isStarting,
        contextSessionsLength,
      }),
    [
      activeSessionStatus,
      agentStudioReady,
      contextSessionsLength,
      isStarting,
      onOpenTaskDetails,
      onCreateSession,
      onSessionSelectionChange,
      onWorkflowStepSelect,
      selectedTask,
      sessionsForTaskLength,
      workflow.createSessionDisabled,
      workflow.selectedInteractionRole,
      workflow.sessionSelectorAutofocusByValue,
      workflow.sessionCreateOptions,
      workflow.sessionSelectorGroups,
      workflow.sessionSelectorValue,
      workflow.workflowSessionByRole,
      workflow.workflowStateByRole,
    ],
  );
};
