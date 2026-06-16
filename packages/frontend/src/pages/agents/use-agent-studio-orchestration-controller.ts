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
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentStateContextValue, RepoSettingsInput } from "@/types/state-slices";
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
import { useAgentStudioRepoSettings } from "./use-agent-studio-repo-settings";
import { useAgentStudioRightPanel } from "./use-agent-studio-right-panel";
import type { AgentStudioSelectionControllerResult } from "./use-agent-studio-selection-controller";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";

export type AgentStudioOrchestrationSelectionContext = AgentStudioSelectionControllerResult;

type AgentStudioOrchestrationComposerContext = {
  draftStateKey: string;
};

type AgentStudioOrchestrationActionsContext = {
  updateQuery: (updates: QueryUpdate) => void;
  scheduleSelectionIntent: (intent: AgentStudioSelectionIntent) => void;
  openTaskDetails: () => void;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  settleStartedAgentSession: AgentStateContextValue["settleStartedAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  stopAgentSession: AgentStateContextValue["stopAgentSession"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  readSessionFileSearch: AgentStateContextValue["readSessionFileSearch"];
  readSessionSlashCommands: AgentStateContextValue["readSessionSlashCommands"];
  readSessionSkills: AgentStateContextValue["readSessionSkills"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  setTaskTargetBranch: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  replyAgentApproval: AgentStateContextValue["replyAgentApproval"];
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
};
type UseAgentStudioOrchestrationControllerArgs = {
  activeWorkspaceId: string | null;
  branches: GitBranch[];
  runtimeDefinitions: RuntimeDescriptor[];
  workspaceRepoPath: string | null;
  selection: AgentStudioOrchestrationSelectionContext;
  hasActiveGitConflict: boolean;
  draftStateKey: string;
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
  AgentStudioOrchestrationSelectionContext,
  "viewTaskId"
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
  | "activeSessionContextUsage"
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
    activeTabValue: activeTaskTabId || view.viewTaskId || "__agent_studio_empty__",
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
      activeSessionAgentColors: agentAccentColorsByProfileId,
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
  workspaceRepoPath,
  selection,
  hasActiveGitConflict,
  draftStateKey,
  actions,
}: UseAgentStudioOrchestrationControllerArgs): UseAgentStudioOrchestrationControllerResult {
  const {
    viewTaskId,
    viewRole,
    viewLaunchActionId,
    viewSelectedTask,
    viewSessionsForTask,
    viewActiveSessionSummary,
    viewActiveSession,
    viewSessionRuntimeData,
    viewSessionRuntimeDataError = null,
    viewRuntimeReadiness,
    activeTaskTabId,
    taskTabs,
    availableTabTasks,
    isLoadingTasks,
    isActiveTaskReady,
    handleSelectTab,
    handleCreateTab,
    handleCloseTab,
    handleReorderTab,
  } = selection;
  const agentStudioReady = viewRuntimeReadiness.isReady;
  const {
    updateQuery,
    startAgentSession,
    settleStartedAgentSession,
    sendAgentMessage,
    stopAgentSession,
    updateAgentSessionModel,
    readSessionFileSearch,
    readSessionSlashCommands,
    readSessionSkills,
    humanRequestChangesTask,
    setTaskTargetBranch,
    replyAgentApproval,
    answerAgentQuestion,
    scheduleSelectionIntent,
  } = actions;
  const { repoSettings } = useAgentStudioRepoSettings({
    activeWorkspaceId,
  });
  const { chatSettings, reusablePrompts, chatSettingsLoadError, retryChatSettingsLoad } =
    useAgentStudioChatSettings({ workspaceRepoPath });

  const { specDoc, planDoc, qaDoc } = useAgentStudioDocuments({
    workspaceRepoPath,
    taskId: viewTaskId,
    activeSession: viewActiveSession,
    selectedTask: viewSelectedTask,
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
    activeSessionContextUsage,
    handleSelectAgentProfile,
    handleSelectModel,
    handleSelectVariant,
  } = useAgentStudioChatComposer({
    workspaceRepoPath,
    activeSession: viewActiveSession,
    activeSessionSummary: viewActiveSessionSummary,
    activeSessionModelCatalog: viewSessionRuntimeData.modelCatalog,
    activeSessionIsLoadingModelCatalog: viewSessionRuntimeData.isLoadingModelCatalog,
    role: viewRole,
    reusablePrompts,
    repoSettings,
    updateAgentSessionModel,
    readSessionFileSearch,
    readSessionSlashCommands,
    ...(readSessionSkills ? { readSessionSkills } : {}),
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
    taskId: viewTaskId,
    role: viewRole,
    launchActionId: viewLaunchActionId,
    activeSession: viewActiveSession,
    activeSessionIsLoadingModelCatalog: viewSessionRuntimeData.isLoadingModelCatalog,
    activeSessionRuntimeDescriptor: viewSessionRuntimeData.modelCatalog?.runtime ?? null,
    selectedModelSelection,
    selectedModelDescriptor,
    sessionsForTask: viewSessionsForTask,
    selectedTask: viewSelectedTask,
    agentStudioReady,
    isActiveTaskReady,
    selectionForNewSession,
    reusablePrompts,
    repoSettings,
    workspaceRepoPath,
    startAgentSession,
    settleStartedAgentSession,
    sendAgentMessage,
    humanRequestChangesTask,
    setTaskTargetBranch,
    answerAgentQuestion,
    updateQuery,
    scheduleSelectionIntent,
  });

  const { isSubmittingApprovalByRequestId, approvalReplyErrorByRequestId, onReplyApproval } =
    useAgentSessionApprovalActions({
      activeSession: viewActiveSession ? toAgentSessionIdentity(viewActiveSession) : null,
      pendingApprovals: viewActiveSession?.pendingApprovals ?? [],
      agentStudioReady,
      replyAgentApproval,
    });

  const roleLabelByRole = useMemo(() => buildRoleLabelByRole(ROLE_OPTIONS), []);
  const selectedSessionContext = useMemo(
    () =>
      buildAgentStudioSelectedSessionContext({
        taskId: viewTaskId,
        role: viewRole,
        selectedTask: viewSelectedTask,
        sessionsForTask: viewSessionsForTask,
        allSessionSummaries: selection.allSessionSummaries,
        activeSession: viewActiveSession,
        activeSessionRuntimeData: {
          todos: viewSessionRuntimeData.todos,
          isLoadingModelCatalog: viewSessionRuntimeData.isLoadingModelCatalog,
        },
        runtimeDefinitions,
        sessionRuntimeDataError: viewSessionRuntimeDataError,
        hasActiveGitConflict,
        transcriptState: selection.viewTranscriptState,
        runtimeReadiness: viewRuntimeReadiness,
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
      selection.viewTranscriptState,
      specDoc,
      viewActiveSession,
      viewSessionRuntimeData.isLoadingModelCatalog,
      viewSessionRuntimeData.todos,
      viewRole,
      viewSelectedTask,
      viewRuntimeReadiness,
      viewSessionRuntimeDataError,
      viewSessionsForTask,
      viewTaskId,
    ],
  );

  const pageModelsArgs = buildAgentStudioPageModelsArgs({
    view: {
      viewTaskId,
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
      activeSessionContextUsage,
      agentAccentColorsByProfileId,
      handleSelectAgentProfile,
      handleSelectModel,
      handleSelectVariant,
    },
    chatSettings,
    composer: {
      draftStateKey,
    },
  });

  const {
    activeTabValue,
    agentStudioTaskTabsModel,
    agentStudioHeaderModel,
    agentStudioWorkspaceSidebarModel,
    agentChatModel,
  } = useAgentStudioPageModels(pageModelsArgs);

  const rightPanel = useAgentStudioRightPanel({
    role: selectedSessionContext.rightPanel.role,
    hasTaskContext: selectedSessionContext.rightPanel.hasTaskContext,
    hasDocumentPanel: selectedSessionContext.rightPanel.hasDocumentPanel,
    hasBuildToolsPanel: selectedSessionContext.rightPanel.hasBuildToolsPanel,
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
