import type {
  ChatSettings,
  GitBranch,
  GitTargetBranch,
  RuntimeDescriptor,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useMemo } from "react";
import type {
  AgentStudioTaskTabsModel,
  SessionStartModalModel,
} from "@/components/features/agents";
import { useAgentSessionApprovalActions } from "@/components/features/agents/agent-chat/use-agent-session-approval-actions";
import type { HumanReviewFeedbackModalModel } from "@/features/human-review-feedback/human-review-feedback-types";
import type { SessionRepoReadinessState as AgentStudioReadinessState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentStateContextValue, RepoSettingsInput } from "@/types/state-slices";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./agent-studio-navigation";
import { ROLE_OPTIONS } from "./agents-page-constants";
import { buildRoleLabelByRole } from "./agents-page-view-model";
import { useAgentStudioChatComposer } from "./chat-composer/use-agent-studio-chat-composer";
import type {
  AgentStudioSelectedSessionContext,
  AgentStudioSelectedSessionContextInput,
} from "./selected-session/selected-session-context";
import { buildAgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import { useAgentStudioChatSettings } from "./use-agent-studio-chat-settings";
import { useAgentStudioDocuments } from "./use-agent-studio-documents";
import { useAgentStudioPageModels } from "./use-agent-studio-page-models";
import { useAgentStudioRepoSettings } from "./use-agent-studio-repo-settings";
import { useAgentStudioRightPanel } from "./use-agent-studio-right-panel";
import type { AgentStudioSelectionControllerResult } from "./use-agent-studio-selection-controller";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";

export type AgentStudioOrchestrationSelectionContext = AgentStudioSelectionControllerResult & {
  contextSwitchVersion: number;
  isSessionSelectionResolving: boolean;
};

export type AgentStudioOrchestrationReadinessContext = {
  agentStudioReadinessState: AgentStudioReadinessState;
  agentStudioReady: boolean;
  isRuntimeStarting: boolean;
  agentStudioBlockedReason: string | null;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

type AgentStudioOrchestrationComposerContext = {
  draftStateKey: string;
};

type AgentStudioOrchestrationActionsContext = {
  updateQuery: (updates: QueryUpdate) => void;
  onContextSwitchIntent: () => void;
  scheduleSelectionIntent: (intent: {
    taskId: string;
    externalSessionId: string | null;
    role: AgentRole;
  }) => void;
  openTaskDetails: () => void;
  startAgentSession: AgentStateContextValue["startAgentSession"];
  settleStartedAgentSession: AgentStateContextValue["settleStartedAgentSession"];
  sendAgentMessage: AgentStateContextValue["sendAgentMessage"];
  stopAgentSession: AgentStateContextValue["stopAgentSession"];
  updateAgentSessionModel: AgentStateContextValue["updateAgentSessionModel"];
  readSessionFileSearch: AgentStateContextValue["readSessionFileSearch"];
  readSessionSlashCommands: AgentStateContextValue["readSessionSlashCommands"];
  readSessionSkills: AgentStateContextValue["readSessionSkills"];
  loadRequestedTaskSessionHistory: AgentStateContextValue["loadRequestedTaskSessionHistory"];
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
  setTaskTargetBranch: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  replyAgentApproval: AgentStateContextValue["replyAgentApproval"];
  answerAgentQuestion: AgentStateContextValue["answerAgentQuestion"];
};
type UseAgentStudioOrchestrationControllerArgs = {
  activeWorkspace: WorkspaceRecord | null;
  branches: GitBranch[];
  runtimeDefinitions: RuntimeDescriptor[];
  selection: AgentStudioOrchestrationSelectionContext;
  readiness: AgentStudioOrchestrationReadinessContext;
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

type BuildSelectedSessionContextFromOrchestrationInput = Omit<
  AgentStudioSelectedSessionContextInput,
  "isTaskHydrating" | "sessionRuntimeDataError"
> & {
  viewSessionRuntimeDataError?: string | null;
  isActiveTaskReady: boolean;
  isActiveTaskReadinessFailed: boolean;
};

export const buildAgentStudioSelectedSessionContextFromOrchestration = ({
  viewSessionRuntimeDataError,
  isActiveTaskReady,
  isActiveTaskReadinessFailed,
  ...input
}: BuildSelectedSessionContextFromOrchestrationInput): AgentStudioSelectedSessionContext =>
  buildAgentStudioSelectedSessionContext({
    ...input,
    sessionRuntimeDataError: viewSessionRuntimeDataError ?? null,
    isTaskHydrating: Boolean(input.taskId && !isActiveTaskReady && !isActiveTaskReadinessFailed),
  });

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
  activeWorkspace,
  branches,
  runtimeDefinitions,
  selection,
  readiness,
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
    viewSessionRuntimeDataError = null,
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
  const { agentStudioReady } = readiness;
  const {
    updateQuery,
    onContextSwitchIntent,
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
    activeWorkspace,
  });
  const { chatSettings, reusablePrompts, chatSettingsLoadError, retryChatSettingsLoad } =
    useAgentStudioChatSettings({ activeWorkspace });

  const { specDoc, planDoc, qaDoc } = useAgentStudioDocuments({
    activeWorkspace,
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
    activeWorkspace,
    activeSession: viewActiveSession,
    activeSessionSummary: viewActiveSessionSummary,
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
    activeWorkspace,
    branches,
    taskId: viewTaskId,
    role: viewRole,
    launchActionId: viewLaunchActionId,
    activeSession: viewActiveSession,
    selectedModelSelection,
    selectedModelDescriptor,
    sessionsForTask: viewSessionsForTask,
    selectedTask: viewSelectedTask,
    agentStudioReady,
    isActiveTaskReady,
    isSessionSelectionResolving: selection.isSessionSelectionResolving,
    selectionForNewSession,
    reusablePrompts,
    repoSettings,
    startAgentSession,
    settleStartedAgentSession,
    sendAgentMessage,
    humanRequestChangesTask,
    setTaskTargetBranch,
    answerAgentQuestion,
    updateQuery,
    scheduleSelectionIntent,
    onContextSwitchIntent,
  });

  const { isSubmittingApprovalByRequestId, approvalReplyErrorByRequestId, onReplyApproval } =
    useAgentSessionApprovalActions({
      activeExternalSessionId: viewActiveSession?.externalSessionId ?? null,
      pendingApprovals: viewActiveSession?.pendingApprovals ?? [],
      agentStudioReady,
      replyAgentApproval,
    });

  const roleLabelByRole = useMemo(() => buildRoleLabelByRole(ROLE_OPTIONS), []);
  const selectedSessionContext = useMemo(
    () =>
      buildAgentStudioSelectedSessionContextFromOrchestration({
        taskId: viewTaskId,
        role: viewRole,
        selectedTask: viewSelectedTask,
        sessionsForTask: viewSessionsForTask,
        allSessionSummaries: selection.allSessionSummaries,
        activeSession: viewActiveSession,
        runtimeDefinitions,
        viewSessionRuntimeDataError,
        hasActiveGitConflict,
        isActiveTaskReady,
        isActiveTaskReadinessFailed: selection.isActiveTaskReadinessFailed,
        isSessionHistoryHydrated: selection.isViewSessionHistoryHydrated,
        isSessionHistoryHydrating: selection.isViewSessionHistoryHydrating,
        isSessionSelectionResolving: selection.isSessionSelectionResolving,
        isWaitingForRuntimeReadiness: selection.isViewSessionWaitingForRuntimeReadiness,
        isSessionHistoryLoadFailed: selection.isViewSessionHistoryLoadFailed,
        activeSessionContextUsage,
        documents: {
          specDoc,
          planDoc,
          qaDoc,
        },
        readiness,
        sessionActions: {
          isStarting,
          isSessionWorking,
          canKickoffNewSession,
          kickoffLabel,
          startLaunchKickoff,
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
      activeSessionContextUsage,
      approvalReplyErrorByRequestId,
      canKickoffNewSession,
      hasActiveGitConflict,
      isActiveTaskReady,
      isSessionWorking,
      isStarting,
      isSubmittingApprovalByRequestId,
      isSubmittingQuestionByRequestId,
      kickoffLabel,
      onReplyApproval,
      onSubmitQuestionAnswers,
      planDoc,
      qaDoc,
      readiness,
      roleLabelByRole,
      runtimeDefinitions,
      selection.allSessionSummaries,
      selection.isActiveTaskReadinessFailed,
      selection.isSessionSelectionResolving,
      selection.isViewSessionHistoryHydrated,
      selection.isViewSessionHistoryLoadFailed,
      selection.isViewSessionHistoryHydrating,
      selection.isViewSessionWaitingForRuntimeReadiness,
      specDoc,
      startLaunchKickoff,
      viewActiveSession,
      viewRole,
      viewSelectedTask,
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
      canStopSession,
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
