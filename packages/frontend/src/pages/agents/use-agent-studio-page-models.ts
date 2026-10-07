import type { ChatSettings, RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useMemo } from "react";
import type { AgentStudioQuickActionOption } from "./agent-studio-quick-actions";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import { buildTaskExecutionDocumentPanelModel } from "./agents-page-view-model";
import type { AgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import {
  type AgentStudioChatComposerContext,
  type AgentStudioChatModelSelectionContext,
  type AgentStudioChatSessionActionsContext,
  useAgentStudioChatModel,
} from "./use-agent-studio-chat-model";
import { useAgentStudioHeaderModel } from "./use-agent-studio-page-submodels";

type AgentStudioSessionActionsContext = AgentStudioChatSessionActionsContext & {
  handleWorkflowStepSelect: (role: AgentRole, sessionValue: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handlePrepareMessageFirstSession: (option: SessionCreateOption) => void;
  handleQuickAction: (option: AgentStudioQuickActionOption) => void;
  openTaskDetails: () => void;
};

type UseAgentStudioPageModelsArgs = {
  selectedSession: AgentStudioSelectedSessionContext;
  sessionActions: AgentStudioSessionActionsContext;
  modelSelection: AgentStudioChatModelSelectionContext;
  chatSettings: ChatSettings;
  runtimeDefinitions: RuntimeDescriptor[];
  composer: AgentStudioChatComposerContext;
};

export function useAgentStudioPageModels({
  selectedSession,
  sessionActions,
  modelSelection,
  chatSettings,
  runtimeDefinitions,
  composer,
}: UseAgentStudioPageModelsArgs) {
  const agentStudioReady = selectedSession.selectedSession.runtimeReadiness.state === "ready";

  const {
    workflowSessionByRole,
    workflowStateByRole,
    sessionSelectorGroups,
    sessionSelectorAutofocusByValue,
    sessionSelectorValue,
    sessionCreateOptions,
    quickActions,
    primaryQuickAction,
  } = selectedSession.workflow;

  const agentStudioHeaderModel = useAgentStudioHeaderModel({
    selectedTask: selectedSession.selectedTask,
    onOpenTaskDetails: selectedSession.selectedTask ? sessionActions.openTaskDetails : null,
    selectedRole: selectedSession.role,
    sessionsForTaskLength: selectedSession.sessionsForTask.length,
    agentStudioReady,
    isStarting: sessionActions.isStarting,
    onWorkflowStepSelect: sessionActions.handleWorkflowStepSelect,
    onSessionSelectionChange: sessionActions.handleSessionSelectionChange,
    onPrepareMessageFirstSession: sessionActions.handlePrepareMessageFirstSession,
    onQuickAction: sessionActions.handleQuickAction,
    workflow: {
      workflowStateByRole,
      workflowSessionByRole,
      sessionSelectorAutofocusByValue,
      sessionSelectorValue,
      sessionSelectorGroups,
      sessionCreateOptions,
      quickActions,
      primaryQuickAction,
    },
  });

  const taskExecutionDocumentPanelModel = useMemo(
    () =>
      buildTaskExecutionDocumentPanelModel({
        activeDocument: selectedSession.documents.activeDocument,
      }),
    [selectedSession.documents.activeDocument],
  );

  const agentChatModel = useAgentStudioChatModel({
    selectedSession,
    sessionActions,
    modelSelection,
    chatSettings,
    runtimeDefinitions,
    composer,
  });

  return {
    agentStudioHeaderModel,
    taskExecutionDocumentPanelModel,
    agentChatModel,
  } satisfies {
    agentStudioHeaderModel: ReturnType<typeof useAgentStudioHeaderModel>;
    taskExecutionDocumentPanelModel: ReturnType<typeof buildTaskExecutionDocumentPanelModel>;
    agentChatModel: ReturnType<typeof useAgentStudioChatModel>;
  };
}
