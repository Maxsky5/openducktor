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
  TaskExecutionSelectedFile,
  TaskExecutionSelectedFilePreviewModel,
} from "@/components/features/agents";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type { RunSessionStartWorkflow } from "@/features/session-start";
import { useWorkspaceStateContext } from "@/state/app-state-contexts";
import { useAgentModelFavorites } from "@/state/mutations/use-agent-model-favorites";
import type { AgentOperationsContextValue, RepoSettingsInput } from "@/types/state-slices";
import { ROLE_OPTIONS } from "./agents-page-constants";
import { buildRoleLabelByRole } from "./agents-page-view-model";
import { useAgentStudioChatComposer } from "./chat-composer/use-agent-studio-chat-composer";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./query-sync/agent-studio-navigation";
import type { AgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import { buildAgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import type { SelectAgentStudioSelection } from "./shell/agent-studio-selection-state";
import { useAgentStudioChatSettings } from "./use-agent-studio-chat-settings";
import { useAgentStudioDocuments } from "./use-agent-studio-documents";
import { useAgentStudioPageModels } from "./use-agent-studio-page-models";
import { useAgentStudioRightPanel } from "./use-agent-studio-right-panel";
import type { AgentStudioSelectionControllerResult } from "./use-agent-studio-selection-controller";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";
import type { UseTaskExecutionFilePreviewControllerResult } from "./use-task-execution-file-preview-controller";

export type AgentStudioOrchestrationSelectionContext = AgentStudioSelectionControllerResult;

type AgentStudioOrchestrationComposerContext = Parameters<
  typeof useAgentStudioPageModels
>[0]["composer"];

type AgentStudioOrchestrationActionsContext = {
  scheduleQueryUpdate: (updates: QueryUpdate) => void;
  selectAgentStudioSelection: SelectAgentStudioSelection;
  openTaskDetails: () => void;
  runSessionStartWorkflow: RunSessionStartWorkflow;
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"];
  stopAgentSession: AgentOperationsContextValue["stopAgentSession"];
  loadAgentSessionHistory: AgentOperationsContextValue["loadAgentSessionHistory"];
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
  githubIntegrationEnabled: boolean;
  workspaceRepoPath: string | null;
  selection: AgentStudioOrchestrationSelectionContext;
  taskExecutionFilePreview: UseTaskExecutionFilePreviewControllerResult;
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
  taskExecutionDocumentPanelModel: ReturnType<
    typeof useAgentStudioPageModels
  >["taskExecutionDocumentPanelModel"];
  agentChatModel: ReturnType<typeof useAgentStudioPageModels>["agentChatModel"];
  rightPanel: ReturnType<typeof useAgentStudioRightPanel>;
  taskExecutionSelectedFilePreviewModel: TaskExecutionSelectedFilePreviewModel;
  onSelectTaskExecutionFile: (file: TaskExecutionSelectedFile) => void;
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
  | "supportsAttachments"
  | "supportsSlashCommands"
  | "supportsFileSearch"
  | "supportsSkillReferences"
  | "supportsSubagentReferences"
  | "slashCommandCatalog"
  | "slashCommands"
  | "slashCommandsError"
  | "isSlashCommandsLoading"
  | "skillCatalog"
  | "skills"
  | "skillsError"
  | "isSkillsLoading"
  | "subagentCatalog"
  | "subagents"
  | "subagentsError"
  | "isSubagentsLoading"
  | "searchFiles"
  | "agentProfileOptions"
  | "modelPicker"
  | "variantOptions"
  | "selectedSessionContextUsage"
  | "agentAccentColorsByProfileId"
  | "handleSelectAgentProfile"
  | "handleSelectVariant"
>;

type BuildAgentStudioPageModelsArgsInput = {
  view: AgentStudioPageModelsViewContext;
  selectedSession: AgentStudioSelectedSessionContext;
  tabs: AgentStudioPageModelsTabsContext;
  sessionActions: AgentStudioPageModelsSessionActionsContext;
  modelSelection: AgentStudioPageModelsModelSelectionContext;
  chatSettings: ChatSettings;
  runtimeDefinitions: RuntimeDescriptor[];
  composer: AgentStudioOrchestrationComposerContext;
};

export const buildAgentStudioPageModelsArgs = ({
  view,
  selectedSession,
  tabs,
  sessionActions,
  modelSelection,
  chatSettings,
  runtimeDefinitions,
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
    runtimeDefinitions,
    modelSelection: {
      ...restOfModelSelection,
      agentOptions: agentProfileOptions,
      agentAccentColorsByProfileId,
      onSelectAgent: handleSelectAgentProfile,
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
  githubIntegrationEnabled,
  workspaceRepoPath,
  selection,
  taskExecutionFilePreview,
  hasActiveGitConflict,
  composer,
  actions,
}: UseAgentStudioOrchestrationControllerArgs): UseAgentStudioOrchestrationControllerResult {
  const { saveAgentModelFavorites } = useWorkspaceStateContext();
  const agentModelFavoriteState = useAgentModelFavorites({ saveAgentModelFavorites });
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
  const selectedSession = view.selectedSession;
  const agentStudioReady = selectedSession.runtimeReadiness.state === "ready";
  const {
    scheduleQueryUpdate,
    runSessionStartWorkflow,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    humanRequestChangesTask,
    setTaskTargetBranch,
    replyAgentApproval,
    answerAgentQuestion,
    selectAgentStudioSelection,
  } = actions;
  const { chatSettings, reusablePrompts, chatSettingsLoadError, retryChatSettingsLoad } =
    useAgentStudioChatSettings({ workspaceRepoPath });

  const { specDoc, planDoc, qaDoc } = useAgentStudioDocuments({
    workspaceRepoPath,
    taskId: view.taskId,
    selectedSessionIdentity: selectedSession.identity,
    loadedSession: selectedSession.loadedSession,
    selectedTask: view.selectedTask,
  });

  const {
    selectionForNewSession,
    selectedModelSelection,
    isSelectedSessionModelSendable,
    selectedModelDescriptor,
    isSelectionCatalogLoading,
    supportsProfiles,
    supportsAttachments,
    supportsSlashCommands,
    supportsFileSearch,
    supportsSkillReferences,
    supportsSubagentReferences,
    slashCommandCatalog,
    slashCommands,
    slashCommandsError,
    isSlashCommandsLoading,
    skillCatalog,
    skills,
    skillsError,
    isSkillsLoading,
    subagentCatalog,
    subagents,
    subagentsError,
    isSubagentsLoading,
    searchFiles,
    agentProfileOptions,
    modelPicker,
    variantOptions,
    agentAccentColorsByProfileId,
    selectedSessionContextUsage,
    handleSelectAgentProfile,
    handleSelectVariant,
  } = useAgentStudioChatComposer({
    workspaceRepoPath,
    selectedSession,
    role: view.role,
    reusablePrompts,
    repoSettings,
    favoriteState: agentModelFavoriteState,
    updateAgentSessionModel,
  });

  const {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    isSending,
    isSubmittingQuestionByRequestId,
    isSubmittingApprovalByRequestId,
    approvalReplyErrorByRequestId,
    isSessionWorking,
    isWaitingInput,
    busySendBlockedReason,
    canUseKickoffPrompt,
    kickoffLabel,
    canStopSession,
    startLaunchKickoff,
    onSend,
    onSubmitQuestionAnswers,
    onReplyApproval,
    handleWorkflowStepSelect,
    handleSessionSelectionChange,
    handlePrepareMessageFirstSession,
    handleQuickAction,
  } = useAgentStudioSessionActions({
    activeWorkspaceId,
    branches,
    favoriteState: agentModelFavoriteState,
    taskId: view.taskId,
    role: view.role,
    launchActionId: view.launchActionId,
    selectedSession,
    runtimeDefinitions,
    selectedModelDescriptor,
    supportsAttachments,
    sessionsForTask: view.sessionsForTask,
    selectedTask: view.selectedTask,
    isSelectedSessionModelSendable,
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
    replyAgentApproval,
    answerAgentQuestion,
    scheduleQueryUpdate,
    selectAgentStudioSelection,
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
        selectedSession,
        hasActiveGitConflict,
        documents: {
          specDoc,
          planDoc,
          qaDoc,
        },
        sessionActions: {
          isSessionWorking,
          onSubmitQuestionAnswers,
          isSubmittingQuestionByRequestId,
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
      selection.allSessionSummaries,
      selectedSession,
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
      canUseKickoffPrompt,
      kickoffLabel,
      canStopSession,
      startLaunchKickoff,
      onSend,
      handleWorkflowStepSelect,
      handleSessionSelectionChange,
      handlePrepareMessageFirstSession,
      handleQuickAction,
      stopAgentSession,
      loadAgentSessionHistory: actions.loadAgentSessionHistory,
    },
    modelSelection: {
      selectedModelSelection,
      selectedModelDescriptor,
      isSelectionCatalogLoading,
      supportsProfiles: supportsProfiles ?? true,
      supportsAttachments,
      supportsSlashCommands,
      supportsFileSearch,
      supportsSkillReferences,
      supportsSubagentReferences,
      slashCommandCatalog,
      slashCommands,
      slashCommandsError,
      isSlashCommandsLoading,
      skillCatalog,
      skills,
      skillsError,
      isSkillsLoading,
      subagentCatalog,
      subagents,
      subagentsError,
      isSubagentsLoading,
      searchFiles,
      agentProfileOptions,
      modelPicker,
      variantOptions,
      selectedSessionContextUsage,
      agentAccentColorsByProfileId,
      handleSelectAgentProfile,
      handleSelectVariant,
    },
    chatSettings,
    runtimeDefinitions,
    composer,
  });

  const {
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    taskExecutionDocumentPanelModel,
    agentChatModel,
  } = useAgentStudioPageModels(pageModelsArgs);

  const rightPanel = useAgentStudioRightPanel({
    role: selectedSessionContext.role,
    hasTaskContext: Boolean(selectedSessionContext.taskId),
    hasDocumentPanel: selectedSessionContext.documents.activeDocument !== null,
    hasGithubIntegration: githubIntegrationEnabled,
    hasLinkedGithubPullRequest: view.selectedTask?.pullRequest?.providerId === "github",
  });
  const { model: taskExecutionSelectedFilePreviewModel, onSelectFile: onSelectTaskExecutionFile } =
    taskExecutionFilePreview;

  return {
    repoSettings,
    chatSettingsLoadError,
    retryChatSettingsLoad,
    humanReviewFeedbackModal,
    sessionStartModal,
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    taskExecutionDocumentPanelModel,
    agentChatModel,
    rightPanel,
    taskExecutionSelectedFilePreviewModel,
    onSelectTaskExecutionFile,
    startSessionRequest,
  };
}
