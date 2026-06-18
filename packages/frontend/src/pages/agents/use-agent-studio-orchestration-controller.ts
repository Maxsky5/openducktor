import type {
  ChatSettings,
  GitBranch,
  GitTargetBranch,
  RuntimeDescriptor,
} from "@openducktor/contracts";
import { useMemo } from "react";
import type {
  AgentStudioTaskTabsModel,
  SessionStartModalModel,
} from "@/components/features/agents";
import { useAgentSessionApprovalActions } from "@/components/features/agents/agent-chat/use-agent-session-approval-actions";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type { RunSessionStartWorkflow } from "@/features/session-start";
import type { AgentOperationsContextValue, RepoSettingsInput } from "@/types/state-slices";
import { ROLE_OPTIONS } from "./agents-page-constants";
import { buildRoleLabelByRole } from "./agents-page-view-model";
import { useAgentStudioChatComposer } from "./chat-composer/use-agent-studio-chat-composer";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./query-sync/agent-studio-navigation";
import type { AgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import { buildAgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import type { AgentStudioSelectionIntent } from "./shell/agent-studio-selection-intent";
import { useAgentStudioChatSettings } from "./use-agent-studio-chat-settings";
import { useAgentStudioDocuments } from "./use-agent-studio-documents";
import { useAgentStudioPageModels } from "./use-agent-studio-page-models";
import { useAgentStudioRightPanel } from "./use-agent-studio-right-panel";
import type { AgentStudioSelectionControllerResult } from "./use-agent-studio-selection-controller";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";

export type AgentStudioOrchestrationSelectionContext = AgentStudioSelectionControllerResult;

type AgentStudioOrchestrationComposerContext = Parameters<
  typeof useAgentStudioPageModels
>[0]["composer"];

type AgentStudioOrchestrationActionsContext = {
  updateQuery: (updates: QueryUpdate) => void;
  scheduleSelectionIntent: (intent: AgentStudioSelectionIntent) => void;
  openTaskDetails: () => void;
  runSessionStartWorkflow: RunSessionStartWorkflow;
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"];
  stopAgentSession: AgentOperationsContextValue["stopAgentSession"];
  updateAgentSessionModel: AgentOperationsContextValue["updateAgentSessionModel"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  setTaskTargetBranch: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  replyAgentApproval: AgentOperationsContextValue["replyAgentApproval"];
  answerAgentQuestion: AgentOperationsContextValue["answerAgentQuestion"];
};
type UseAgentStudioOrchestrationControllerArgs = {
  activeWorkspaceId: string | null;
  branches: GitBranch[];
  runtimeDefinitions: RuntimeDescriptor[];
  repoSettings: RepoSettingsInput | null;
  workspaceRepoPath: string | null;
  selection: AgentStudioOrchestrationSelectionContext;
  hasActiveGitConflict: boolean;
  composer: AgentStudioOrchestrationComposerContext;
  actions: AgentStudioOrchestrationActionsContext;
};

type UseAgentStudioOrchestrationControllerResult = {
  repoSettings: RepoSettingsInput | null;
  chatSettingsLoadError: Error | null;
  retryChatSettingsLoad: () => void;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  sessionStartModal: SessionStartModalModel | null;
  activeTabValue: string;
  agentStudioTaskTabsModel: AgentStudioTaskTabsModel;
  agentStudioHeaderModel: ReturnType<typeof useAgentStudioPageModels>["agentStudioHeaderModel"];
  agentStudioWorkspaceSidebarModel: ReturnType<
    typeof useAgentStudioPageModels
  >["agentStudioWorkspaceSidebarModel"];
  agentChatModel: ReturnType<typeof useAgentStudioPageModels>["agentChatModel"];
  rightPanel: ReturnType<typeof useAgentStudioRightPanel>;
  startSessionRequest: ReturnType<typeof useAgentStudioSessionActions>["startSessionRequest"];
};

type AgentStudioPageModelsViewContext = Pick<
  AgentStudioOrchestrationSelectionContext["view"],
  "taskId"
>;

type AgentStudioPageModelsTabsContext = Pick<
  AgentStudioOrchestrationSelectionContext,
  | "activeTaskTabId"
  | "taskTabs"
  | "availableTabTasks"
  | "isLoadingTasks"
  | "handleSelectTab"
  | "handleCreateTab"
  | "handleCloseTab"
  | "handleReorderTab"
>;

type AgentStudioPageModelsSessionActionsContext = Parameters<
  typeof useAgentStudioPageModels
>[0]["sessionActions"];

type AgentStudioPageModelsModelSelectionContext = Pick<
  ReturnType<typeof useAgentStudioChatComposer>,
  | "selectedModelSelection"
  | "selectedModelDescriptor"
  | "isSelectionCatalogLoading"
  | "supportsProfiles"
  | "supportsSlashCommands"
  | "supportsFileSearch"
  | "supportsSkillReferences"
  | "slashCommandCatalog"
  | "slashCommands"
  | "slashCommandsError"
  | "isSlashCommandsLoading"
  | "skillCatalog"
  | "skills"
  | "skillsError"
  | "isSkillsLoading"
  | "searchFiles"
  | "agentProfileOptions"
  | "modelOptions"
  | "modelGroups"
  | "variantOptions"
  | "selectedSessionContextUsage"
  | "agentAccentColorsByProfileId"
  | "handleSelectAgentProfile"
  | "handleSelectModel"
  | "handleSelectVariant"
>;

type BuildAgentStudioPageModelsArgsInput = {
  view: AgentStudioPageModelsViewContext;
  selectedSession: AgentStudioSelectedSessionContext;
  tabs: AgentStudioPageModelsTabsContext;
  sessionActions: AgentStudioPageModelsSessionActionsContext;
  modelSelection: AgentStudioPageModelsModelSelectionContext;
  chatSettings: ChatSettings;
  composer: AgentStudioOrchestrationComposerContext;
};

export const buildAgentStudioPageModelsArgs = ({
  view,
  selectedSession,
  tabs,
  sessionActions,
  modelSelection,
  chatSettings,
  composer,
}: BuildAgentStudioPageModelsArgsInput): Parameters<typeof useAgentStudioPageModels>[0] => {
  const {
    activeTaskTabId,
    handleSelectTab,
    handleCreateTab,
    handleCloseTab,
    handleReorderTab,
    ...taskTabs
  } = tabs;
  const {
    handleSelectAgentProfile,
    handleSelectModel,
    handleSelectVariant,
    agentProfileOptions,
    agentAccentColorsByProfileId,
    ...restOfModelSelection
  } = modelSelection;

  return {
    activeTabValue: activeTaskTabId || view.taskId || "__agent_studio_empty__",
    selectedSession,
    taskTabs: {
      ...taskTabs,
      onSelectTab: handleSelectTab,
      onCreateTab: handleCreateTab,
      onCloseTab: handleCloseTab,
      onReorderTab: handleReorderTab,
    },
    sessionActions,
    chatSettings,
    modelSelection: {
      ...restOfModelSelection,
      agentOptions: agentProfileOptions,
      agentAccentColorsByProfileId,
      onSelectAgent: handleSelectAgentProfile,
      onSelectModel: handleSelectModel,
      onSelectVariant: handleSelectVariant,
    },
    composer,
  };
};

export function useAgentStudioOrchestrationController({
  activeWorkspaceId,
  branches,
  runtimeDefinitions,
  repoSettings,
  workspaceRepoPath,
  selection,
  hasActiveGitConflict,
  composer,
  actions,
}: UseAgentStudioOrchestrationControllerArgs): UseAgentStudioOrchestrationControllerResult {
  const {
    view,
    activeTaskTabId,
    taskTabs,
    availableTabTasks,
    isLoadingTasks,
    handleSelectTab,
    handleCreateTab,
    handleCloseTab,
    handleReorderTab,
  } = selection;
  const agentStudioReady = view.runtimeReadiness.isReady;
  const {
    updateQuery,
    runSessionStartWorkflow,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    humanRequestChangesTask,
    setTaskTargetBranch,
    replyAgentApproval,
    answerAgentQuestion,
    scheduleSelectionIntent,
  } = actions;
  const { chatSettings, reusablePrompts, chatSettingsLoadError, retryChatSettingsLoad } =
    useAgentStudioChatSettings({ workspaceRepoPath });

  const { specDoc, planDoc, qaDoc } = useAgentStudioDocuments({
    workspaceRepoPath,
    taskId: view.taskId,
    selectedSessionIdentity: view.selectedSessionIdentity,
    loadedSession: view.loadedSession,
    selectedTask: view.selectedTask,
  });

  const {
    selectionForNewSession,
    selectedModelSelection,
    selectedModelDescriptor,
    isSelectionCatalogLoading,
    supportsProfiles,
    supportsSlashCommands,
    supportsFileSearch,
    supportsSkillReferences,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
    skillCatalog,
    skills,
    skillsError,
    isSkillsLoading,
    searchFiles,
    agentProfileOptions,
    modelOptions,
    modelGroups,
    variantOptions,
    agentAccentColorsByProfileId,
    selectedSessionContextUsage,
    handleSelectAgentProfile,
    handleSelectModel,
    handleSelectVariant,
  } = useAgentStudioChatComposer({
    workspaceRepoPath,
    loadedSession: view.loadedSession,
    selectedSessionIdentity: view.selectedSessionIdentity,
    selectedSessionModel: view.selectedSessionModel,
    sessionRuntimeData: view.sessionRuntimeData,
    repoReadinessState: view.runtimeReadiness.readinessState,
    role: view.role,
    reusablePrompts,
    repoSettings,
    updateAgentSessionModel,
  });

  const {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    isSending,
    isSubmittingQuestionByRequestId,
    isSessionWorking,
    isWaitingInput,
    busySendBlockedReason,
    canKickoffNewSession,
    kickoffLabel,
    canStopSession,
    startLaunchKickoff,
    onSend,
    onSubmitQuestionAnswers,
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handlePrepareMessageFirstSession,
    handleQuickAction,
  } = useAgentStudioSessionActions({
    activeWorkspaceId,
    branches,
    taskId: view.taskId,
    role: view.role,
    launchActionId: view.launchActionId,
    selectedSessionIdentity: view.selectedSessionIdentity,
    selectedSessionActivityState: view.selectedSessionActivityState,
    selectedSessionModel: view.selectedSessionModel,
    loadedSession: view.loadedSession,
    sessionRuntimeData: view.sessionRuntimeData,
    runtimeDefinitions,
    selectedModelDescriptor,
    sessionsForTask: view.sessionsForTask,
    selectedTask: view.selectedTask,
    agentStudioReady,
    isActiveTaskReady: view.isTaskReady,
    selectionForNewSession,
    reusablePrompts,
    repoSettings,
    workspaceRepoPath,
    runSessionStartWorkflow,
    sendAgentMessage,
    humanRequestChangesTask,
    setTaskTargetBranch,
    answerAgentQuestion,
    updateQuery,
    scheduleSelectionIntent,
  });

  const { isSubmittingApprovalByRequestId, approvalReplyErrorByRequestId, onReplyApproval } =
    useAgentSessionApprovalActions({
      sessionIdentity: view.selectedSessionIdentity,
      pendingApprovals: view.loadedSession?.pendingApprovals ?? [],
      canReplyToApprovals: agentStudioReady,
      replyAgentApproval,
    });

  const roleLabelByRole = useMemo(() => buildRoleLabelByRole(ROLE_OPTIONS), []);
  const selectedSessionContext = useMemo(
    () =>
      buildAgentStudioSelectedSessionContext({
        taskId: view.taskId,
        role: view.role,
        selectedTask: view.selectedTask,
        sessionsForTask: view.sessionsForTask,
        allSessionSummaries: selection.allSessionSummaries,
        selectedSessionIdentity: view.selectedSessionIdentity,
        loadedSession: view.loadedSession,
        sessionRuntimeData: view.sessionRuntimeData,
        runtimeDefinitions,
        hasActiveGitConflict,
        transcriptState: view.transcriptState,
        runtimeReadiness: view.runtimeReadiness,
        documents: {
          specDoc,
          planDoc,
          qaDoc,
        },
        sessionActions: {
          isSessionWorking,
          onSubmitQuestionAnswers,
          isSubmittingQuestionByRequestId,
        },
        approvals: {
          isSubmittingApprovalByRequestId,
          approvalReplyErrorByRequestId,
          onReplyApproval,
        },
        roleLabelByRole,
      }),
    [
      approvalReplyErrorByRequestId,
      hasActiveGitConflict,
      isSessionWorking,
      isSubmittingApprovalByRequestId,
      isSubmittingQuestionByRequestId,
      onReplyApproval,
      onSubmitQuestionAnswers,
      planDoc,
      qaDoc,
      roleLabelByRole,
      runtimeDefinitions,
      selection.allSessionSummaries,
      specDoc,
      view,
    ],
  );

  const pageModelsArgs = buildAgentStudioPageModelsArgs({
    view: {
      taskId: view.taskId,
    },
    selectedSession: selectedSessionContext,
    tabs: {
      activeTaskTabId,
      taskTabs,
      availableTabTasks,
      isLoadingTasks,
      handleSelectTab,
      handleCreateTab,
      handleCloseTab,
      handleReorderTab,
    },
    sessionActions: {
      openTaskDetails: actions.openTaskDetails,
      isStarting,
      isSending,
      isSessionWorking,
      isWaitingInput,
      busySendBlockedReason,
      canKickoffNewSession,
      kickoffLabel,
      canStopSession,
      startLaunchKickoff,
      onSend,
      handleWorkflowStepSelect,
      handleSessionSelectionChange,
      handlePrepareMessageFirstSession,
      handleQuickAction,
      stopAgentSession,
    },
    modelSelection: {
      selectedModelSelection,
      selectedModelDescriptor,
      isSelectionCatalogLoading,
      supportsProfiles: supportsProfiles ?? true,
      supportsSlashCommands,
      supportsFileSearch,
      supportsSkillReferences,
      slashCommandCatalog,
      slashCommands,
      slashCommandsError,
      isSlashCommandsLoading,
      skillCatalog,
      skills,
      skillsError,
      isSkillsLoading,
      searchFiles,
      agentProfileOptions,
      modelOptions,
      modelGroups,
      variantOptions,
      selectedSessionContextUsage,
      agentAccentColorsByProfileId,
      handleSelectAgentProfile,
      handleSelectModel,
      handleSelectVariant,
    },
    chatSettings,
    composer,
  });

  const {
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
  } = useAgentStudioPageModels(pageModelsArgs);

  const rightPanel = useAgentStudioRightPanel({
    role: selectedSessionContext.role,
    hasTaskContext: Boolean(selectedSessionContext.taskId),
    hasDocumentPanel: selectedSessionContext.documents.activeDocument !== null,
  });

  return {
    repoSettings,
    chatSettingsLoadError,
    retryChatSettingsLoad,
    humanReviewFeedbackModal,
    sessionStartModal,
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
    rightPanel,
    startSessionRequest,
  };
}
