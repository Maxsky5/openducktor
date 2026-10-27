import type { SessionCreateOption } from "./agents-page-session-tabs";
import type { ChatSettings, RuntimeDescriptor } from "@openducktor/contracts";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { roleFocusArtifact, type BuiltinRoleId as AgentRole } from "@openducktor/workflows";
import { useCallback, useMemo, useState } from "react";
import type { TaskExecutionDocumentPanelModel } from "@/components/features/agents/task-execution-document-panel";
import type {
  ArtifactSelection,
  TaskArtifactsProps,
} from "@/components/features/task-artifacts/task-artifacts";
import type {
  AgentStudioQuickActionOption,
  AgentStudioSessionQuickActionOption,
  AgentStudioTaskQuickAction,
} from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
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
  handleQuickAction: (option: AgentStudioSessionQuickActionOption) => void;
  /** Opens a task workflow from the header, such as the approval modal. */
  runTaskQuickAction: (action: AgentStudioTaskQuickAction) => void;
  openTaskDetails: () => void;
};

type UseAgentStudioPageModelsArgs = {
  artifactScope?: TaskArtifactsProps | null;
  selectedSession: AgentStudioSelectedSessionContext;
  sessionActions: AgentStudioSessionActionsContext;
  modelSelection: AgentStudioChatModelSelectionContext;
  chatSettings: ChatSettings | null;
  runtimeDefinitions: RuntimeDescriptor[];
  composer: AgentStudioChatComposerContext;
};

export function useAgentStudioPageModels({
  artifactScope = null,
  selectedSession,
  sessionActions,
  modelSelection,
  chatSettings,
  runtimeDefinitions,
  composer,
}: UseAgentStudioPageModelsArgs) {
  const agentStudioReady = selectedSession.selectedSession.runtimeReadiness.state === "ready";
  const { handleQuickAction, runTaskQuickAction } = sessionActions;
  const onQuickAction = useCallback(
    (option: AgentStudioQuickActionOption): void => {
      if (option.kind === "task_action") {
        runTaskQuickAction(option.taskAction);
        return;
      }
      handleQuickAction(option);
    },
    [handleQuickAction, runTaskQuickAction],
  );

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
    onQuickAction,
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

  const identity = selectedSession.selectedSession.identity;
  const defaultArtifactSelection = useMemo<ArtifactSelection>(() => {
    const code = roleFocusArtifact(selectedSession.role);
    return code ? { kind: "workflow", code } : { kind: "collection" };
  }, [selectedSession.role]);
  const roleSessionKey = JSON.stringify([
    artifactScope?.workspaceId ?? null,
    artifactScope?.repoPath ?? null,
    artifactScope?.taskId ?? selectedSession.taskId,
    selectedSession.role,
    identity ? agentSessionIdentityKey(identity) : null,
  ]);
  const [artifactChoice, setArtifactChoice] = useState<{
    roleSessionKey: string;
    selection: ArtifactSelection | null;
  }>({ roleSessionKey, selection: null });
  if (artifactChoice.roleSessionKey !== roleSessionKey) {
    setArtifactChoice({ roleSessionKey, selection: null });
  }
  const selection =
    artifactChoice.roleSessionKey === roleSessionKey && artifactChoice.selection !== null
      ? artifactChoice.selection
      : defaultArtifactSelection;
  const onSelectionChange = useCallback(
    (nextSelection: ArtifactSelection) =>
      setArtifactChoice({ roleSessionKey, selection: nextSelection }),
    [roleSessionKey],
  );
  const taskExecutionDocumentPanelModel = useMemo<TaskExecutionDocumentPanelModel | null>(
    () => (artifactScope ? { ...artifactScope, selection, onSelectionChange } : null),
    [artifactScope, onSelectionChange, selection],
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
