import type { ChatSettings, RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import type {
  TaskDocumentKind,
  TaskExecutionDocumentPanelModel,
} from "@/components/features/agents/task-execution-document-panel";
import type { AgentStudioQuickActionOption } from "./agent-studio-quick-actions";
import type { SessionCreateOption } from "./agents-page-session-tabs";
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

  // The document choice lasts until the user selects another role session. A return to an earlier
  // session starts again from its first document.
  const { taskDocuments, defaultDocumentKind, roleSessionKey } = selectedSession.documents;
  const [documentChoice, setDocumentChoice] = useState<{
    roleSessionKey: string;
    kind: TaskDocumentKind | null;
  }>({ roleSessionKey, kind: null });
  if (documentChoice.roleSessionKey !== roleSessionKey) {
    setDocumentChoice({ roleSessionKey, kind: null });
  }
  const selectedDocumentKind =
    documentChoice.roleSessionKey === roleSessionKey && documentChoice.kind !== null
      ? documentChoice.kind
      : defaultDocumentKind;
  const selectDocumentKind = useCallback(
    (kind: TaskDocumentKind) => setDocumentChoice({ roleSessionKey, kind }),
    [roleSessionKey],
  );
  const taskExecutionDocumentPanelModel = useMemo<TaskExecutionDocumentPanelModel | null>(
    () =>
      taskDocuments
        ? {
            documents: taskDocuments,
            selectedKind: selectedDocumentKind,
            onSelectKind: selectDocumentKind,
          }
        : null,
    [selectDocumentKind, selectedDocumentKind, taskDocuments],
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
    taskExecutionDocumentPanelModel: TaskExecutionDocumentPanelModel | null;
    agentChatModel: ReturnType<typeof useAgentStudioChatModel>;
  };
}
