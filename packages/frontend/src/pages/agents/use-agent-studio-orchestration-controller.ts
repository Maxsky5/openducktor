import type {
  ChatSettings,
  GitBranch,
  PullRequest,
  RepositoryGitProviderContext,
  RuntimeDescriptor,
} from "@openducktor/contracts";
import { useMemo } from "react";
import type {
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
import type { AgentStudioSelectionControllerResult } from "./use-agent-studio-selection-controller";
import { useAgentStudioSessionActions } from "./use-agent-studio-session-actions";
import type { UseTaskExecutionFilePreviewControllerResult } from "@/components/features/agents/file-preview/use-task-execution-file-preview-controller";

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
  continueInterruptedTurn: AgentOperationsContextValue["continueInterruptedTurn"];
  stopAgentSession: AgentOperationsContextValue["stopAgentSession"];
  loadAgentSessionHistory: AgentOperationsContextValue["loadAgentSessionHistory"];
  updateAgentSessionModel: AgentOperationsContextValue["updateAgentSessionModel"];
  replyAgentApproval: AgentOperationsContextValue["replyAgentApproval"];
  answerAgentQuestion: AgentOperationsContextValue["answerAgentQuestion"];
};
type UseAgentStudioOrchestrationControllerArgs = {
  activeWorkspaceId: string | null;
  branches: GitBranch[];
  runtimeDefinitions: RuntimeDescriptor[];
  repoSettings: RepoSettingsInput | null;
  gitProviderContext: RepositoryGitProviderContext | undefined;
  gitProviderReadError: string | null;
  workspaceRepoPath: string | null;
  selection: AgentStudioOrchestrationSelectionContext;
  taskExecutionFilePreview: UseTaskExecutionFilePreviewControllerResult;
  composer: AgentStudioOrchestrationComposerContext;
  actions: AgentStudioOrchestrationActionsContext;
};

export const resolvePullRequestReviewAvailability = ({
  gitProviderContext,
  gitProviderReadError,
  linkedPullRequest,
}: {
  gitProviderContext: RepositoryGitProviderContext | undefined;
  gitProviderReadError?: string | null;
  linkedPullRequest: PullRequest | undefined;
}) => {
  const supportsPullRequestReview =
    gitProviderContext?.descriptor.capabilities.supportsPullRequestReview === true;
  const readFailedWithoutContext = gitProviderContext == null && gitProviderReadError != null;
  const canShowPullRequestReview = supportsPullRequestReview || readFailedWithoutContext;
  const hasLinkedPullRequest =
    linkedPullRequest !== undefined &&
    (readFailedWithoutContext || linkedPullRequest.providerId === gitProviderContext?.config.id);
  let unavailableReason: string | null = null;
  if (canShowPullRequestReview && gitProviderReadError) {
    unavailableReason = gitProviderReadError;
  } else if (
    supportsPullRequestReview &&
    gitProviderContext &&
    gitProviderContext.health.available === false
  ) {
    unavailableReason =
      gitProviderContext.health.reason ??
      `${gitProviderContext.descriptor.label} is not available for Pull Request review.`;
  }
  return { canShowPullRequestReview, hasLinkedPullRequest, unavailableReason };
};

type UseAgentStudioOrchestrationControllerResult = {
  repoSettings: RepoSettingsInput | null;
  chatSettingsLoadError: Error | null;
  retryChatSettingsLoad: () => void;
  humanReviewFeedbackModal: HumanReviewFeedbackModalModel | null;
  sessionStartModal: SessionStartModalModel | null;
  agentStudioHeaderModel: ReturnType<typeof useAgentStudioPageModels>["agentStudioHeaderModel"];
  /** The page shell adds this action to the header while the git actions report a conflict. */
  gitConflictQuickAction: AgentStudioSelectedSessionContext["workflow"]["gitConflictQuickAction"];
  taskExecutionDocumentPanelModel: ReturnType<
    typeof useAgentStudioPageModels
  >["taskExecutionDocumentPanelModel"];
  agentChatModel: ReturnType<typeof useAgentStudioPageModels>["agentChatModel"];
  pullRequestReview: ReturnType<typeof resolvePullRequestReviewAvailability>;
  taskExecutionSelectedFilePreviewModel: TaskExecutionSelectedFilePreviewModel;
  onSelectTaskExecutionFile: (file: TaskExecutionSelectedFile) => void;
  startSessionRequest: ReturnType<typeof useAgentStudioSessionActions>["startSessionRequest"];
};

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
  | "retrySlashCommands"
  | "retrySkills"
  | "retrySubagents"
  | "onCatalogMenuOpen"
  | "onAgentSelectorOpen"
  | "onVariantSelectorOpen"
  | "searchFiles"
  | "agentProfileOptions"
  | "modelPicker"
  | "variantOptions"
  | "selectedSessionContextUsage"
  | "handleSelectAgentProfile"
  | "handleSelectVariant"
>;

type BuildAgentStudioPageModelsArgsInput = {
  selectedSession: AgentStudioSelectedSessionContext;
  sessionActions: AgentStudioPageModelsSessionActionsContext;
  modelSelection: AgentStudioPageModelsModelSelectionContext;
  chatSettings: ChatSettings;
  runtimeDefinitions: RuntimeDescriptor[];
  composer: AgentStudioOrchestrationComposerContext;
};

export const buildAgentStudioPageModelsArgs = ({
  selectedSession,
  sessionActions,
  modelSelection,
  chatSettings,
  runtimeDefinitions,
  composer,
}: BuildAgentStudioPageModelsArgsInput): Parameters<typeof useAgentStudioPageModels>[0] => {
  const {
    handleSelectAgentProfile,
    handleSelectVariant,
    agentProfileOptions,
    ...restOfModelSelection
  } = modelSelection;

  return {
    selectedSession,
    sessionActions,
    chatSettings,
    runtimeDefinitions,
    modelSelection: {
      ...restOfModelSelection,
      agentOptions: agentProfileOptions,
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
  gitProviderContext,
  gitProviderReadError,
  workspaceRepoPath,
  selection,
  taskExecutionFilePreview,
  composer,
  actions,
}: UseAgentStudioOrchestrationControllerArgs): UseAgentStudioOrchestrationControllerResult {
  const { saveAgentModelFavorites } = useWorkspaceStateContext();
  const agentModelFavoriteState = useAgentModelFavorites({ saveAgentModelFavorites });
  const { view } = selection;
  const selectedSession = view.selectedSession;
  const agentStudioReady = selectedSession.runtimeReadiness.state === "ready";
  const {
    scheduleQueryUpdate,
    runSessionStartWorkflow,
    sendAgentMessage,
    continueInterruptedTurn,
    stopAgentSession,
    updateAgentSessionModel,
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
    newSessionCatalog,
    selectedModelSelection,
    prepareSelectedSessionModelForSend,
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
    retrySlashCommands,
    retrySkills,
    retrySubagents,
    onCatalogMenuOpen,
    onAgentSelectorOpen,
    onVariantSelectorOpen,
    searchFiles,
    agentProfileOptions,
    modelPicker,
    variantOptions,
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
    canResumeSession,
    isResumingSession,
    resumeSessionError,
    persistentResumeError,
    onResumeSession,
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
    prepareSelectedSessionModelForSend,
    agentStudioReady,
    isActiveTaskReady: view.isTaskReady,
    selectionForNewSession,
    newSessionCatalog,
    reusablePrompts,
    repoSettings,
    workspaceRepoPath,
    runSessionStartWorkflow,
    sendAgentMessage,
    continueInterruptedTurn,
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
        selectedSession,
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
        gitProviderContext,
        gitProviderReadError,
      }),
    [
      approvalReplyErrorByRequestId,
      gitProviderContext,
      gitProviderReadError,
      isSessionWorking,
      isSubmittingApprovalByRequestId,
      isSubmittingQuestionByRequestId,
      onReplyApproval,
      onSubmitQuestionAnswers,
      planDoc,
      qaDoc,
      roleLabelByRole,
      selectedSession,
      specDoc,
      view,
    ],
  );

  const pageModelsArgs = buildAgentStudioPageModelsArgs({
    selectedSession: selectedSessionContext,
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
      canResumeSession,
      isResumingSession,
      resumeSessionError,
      persistentResumeError,
      onResumeSession,
      startLaunchKickoff,
      onSend,
      sendAgentMessage: actions.sendAgentMessage,
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
      retrySlashCommands,
      retrySkills,
      retrySubagents,
      onCatalogMenuOpen,
      onAgentSelectorOpen,
      onVariantSelectorOpen,
      searchFiles,
      agentProfileOptions,
      modelPicker,
      variantOptions,
      selectedSessionContextUsage,
      handleSelectAgentProfile,
      handleSelectVariant,
    },
    chatSettings,
    runtimeDefinitions,
    composer,
  });

  const { agentStudioHeaderModel, taskExecutionDocumentPanelModel, agentChatModel } =
    useAgentStudioPageModels(pageModelsArgs);

  const pullRequestReview = resolvePullRequestReviewAvailability({
    gitProviderContext,
    gitProviderReadError,
    linkedPullRequest: view.selectedTask?.pullRequest,
  });
  const { model: taskExecutionSelectedFilePreviewModel, onSelectFile: onSelectTaskExecutionFile } =
    taskExecutionFilePreview;

  return {
    repoSettings,
    chatSettingsLoadError,
    retryChatSettingsLoad,
    humanReviewFeedbackModal,
    sessionStartModal,
    agentStudioHeaderModel,
    gitConflictQuickAction: selectedSessionContext.workflow.gitConflictQuickAction,
    taskExecutionDocumentPanelModel,
    agentChatModel,
    pullRequestReview,
    taskExecutionSelectedFilePreviewModel,
    onSelectTaskExecutionFile,
    startSessionRequest,
  };
}
