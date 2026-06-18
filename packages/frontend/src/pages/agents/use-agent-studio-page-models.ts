import type { ChatSettings, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useMemo } from "react";
import type { AgentStudioTaskTabsModel } from "@/components/features/agents/agent-studio-task-tabs";
import type { AgentStudioQuickActionOption } from "./agent-studio-quick-actions";
import type { SessionCreateOption } from "./agents-page-session-tabs";
import {
  buildAgentStudioTaskTabsModel,
  buildAgentStudioWorkspaceSidebarModel,
} from "./agents-page-view-model";
import type { AgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import {
  type AgentStudioChatComposerContext,
  type AgentStudioChatModelSelectionContext,
  type AgentStudioChatSessionActionsContext,
  useAgentStudioChatModel,
} from "./use-agent-studio-chat-model";
import { useAgentStudioHeaderModel } from "./use-agent-studio-page-submodels";

type AgentStudioTaskTabsContext = {
  taskTabs: AgentStudioTaskTabsModel["tabs"];
  availableTabTasks: TaskCard[];
  isLoadingTasks: boolean;
  onSelectTab: (taskId: string) => void;
  onCreateTab: (taskId: string) => void;
  onCloseTab: (taskId: string) => void;
  onReorderTab: (draggedTaskId: string, targetTaskId: string, position: "before" | "after") => void;
};

type AgentStudioSessionActionsContext = AgentStudioChatSessionActionsContext & {
  handleWorkflowStepSelect: (role: AgentRole, sessionValue: string | null) => void;
  handleSessionSelectionChange: (nextValue: string) => void;
  handlePrepareMessageFirstSession: (option: SessionCreateOption) => void;
  handleQuickAction: (option: AgentStudioQuickActionOption) => void;
  openTaskDetails: () => void;
};

type UseAgentStudioPageModelsArgs = {
  activeTabValue: string;
  selectedSession: AgentStudioSelectedSessionContext;
  taskTabs: AgentStudioTaskTabsContext;
  sessionActions: AgentStudioSessionActionsContext;
  modelSelection: AgentStudioChatModelSelectionContext;
  chatSettings: ChatSettings;
  composer: AgentStudioChatComposerContext;
};

export function useAgentStudioPageModels({
  activeTabValue,
  selectedSession,
  taskTabs,
  sessionActions,
  modelSelection,
  chatSettings,
  composer,
}: UseAgentStudioPageModelsArgs): {
  activeTabValue: string;
  agentStudioTaskTabsModel: AgentStudioTaskTabsModel;
  agentStudioHeaderModel: ReturnType<typeof useAgentStudioHeaderModel>;
  agentStudioWorkspaceSidebarModel: ReturnType<typeof buildAgentStudioWorkspaceSidebarModel>;
  agentChatModel: ReturnType<typeof useAgentStudioChatModel>;
} {
  const agentStudioReady = selectedSession.selectedSession.runtimeReadiness.state === "ready";
  const agentStudioTaskTabsModel = useMemo(
    () =>
      buildAgentStudioTaskTabsModel({
        taskTabs: taskTabs.taskTabs,
        availableTabTasks: taskTabs.availableTabTasks,
        isLoadingTasks: taskTabs.isLoadingTasks,
        onSelectTab: taskTabs.onSelectTab,
        onCreateTab: taskTabs.onCreateTab,
        onCloseTab: taskTabs.onCloseTab,
        onReorderTab: taskTabs.onReorderTab,
        agentStudioReady,
      }),
    [
      agentStudioReady,
      taskTabs.availableTabTasks,
      taskTabs.isLoadingTasks,
      taskTabs.onCloseTab,
      taskTabs.onCreateTab,
      taskTabs.onReorderTab,
      taskTabs.onSelectTab,
      taskTabs.taskTabs,
    ],
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
    onQuickAction: sessionActions.handleQuickAction,
    onResolveGitConflictQuickAction: null,
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

  const agentStudioWorkspaceSidebarModel = useMemo(
    () =>
      buildAgentStudioWorkspaceSidebarModel({
        activeDocument: selectedSession.documents.activeDocument,
      }),
    [selectedSession.documents.activeDocument],
  );

  const agentChatModel = useAgentStudioChatModel({
    selectedSession,
    sessionActions,
    modelSelection,
    chatSettings,
    composer,
  });

  return {
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
  };
}
