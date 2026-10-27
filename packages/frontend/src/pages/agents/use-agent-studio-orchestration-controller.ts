import type {
  ChatSettings,
  GitBranch,
  RepositoryGitProviderContext,
  RuntimeDescriptor,
} from "@openducktor/contracts";
import { useMemo } from "react";
import { useAgentSessionReadModelStateContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { deriveSessionlessTaskTranscriptState } from "@openducktor/frontend-core/sessions/agent-orchestrator/transcript/session-transcript-state";
import { resolvePullRequestReviewAvailability } from "@openducktor/frontend-core/review/pull-request-review-availability";
import type { SessionStartModalModel } from "@openducktor/frontend-core/sessions/start/session-start-modal-model";
import type { AgentStudioTaskQuickAction } from "@openducktor/frontend-core/sessions/start/agent-studio-quick-actions";
import { useMergedTaskTarget } from "@openducktor/frontend-core/tasks/board/use-merged-task-targets";
import type {
  TaskExecutionSelectedFile,
  TaskExecutionSelectedFilePreviewModel,
} from "@/components/features/agents";
import type { HumanReviewFeedbackModalModel } from "@openducktor/frontend-core/tasks/workflow/human-review-feedback-types";
import type { RunSessionStartWorkflow } from "@openducktor/frontend-core/sessions/start/session-start-orchestration";
import { useWorkspaceStateContext } from "@/state/app-state-contexts";
import { useAgentModelFavorites } from "@openducktor/frontend-core/sessions/model-selection/use-agent-model-favorites";
import type { AgentOperationsContextValue, RepoSettingsInput } from "@/types/state-slices";
import { ROLE_OPTIONS } from "./agents-page-constants";
import { buildRoleLabelByRole } from "./agents-page-view-model";
import { useAgentStudioChatComposer } from "./chat-composer/use-agent-studio-chat-composer";
import type { AgentStudioQueryUpdate as QueryUpdate } from "./query-sync/agent-studio-navigation";
import type { AgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import { buildAgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import type { SelectAgentStudioSelection } from "./shell/agent-studio-selection-state";
import { useAgentStudioChatSettings } from "@openducktor/frontend-core/sessions/composer/use-agent-studio-chat-settings";
import { useAgentStudioArtifacts } from "./use-agent-studio-artifacts";
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
  runTaskQuickAction: (action: AgentStudioTaskQuickAction) => void;
  runSessionStartWorkflow: RunSessionStartWorkflow;
  sendAgentMessage: AgentOperationsContextValue["sendAgentMessage"];
  assertCanPrepareSession: Parameters<
    typeof useAgentStudioSessionActions
  >[0]["assertCanPrepareSession"];
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
  | "speed"
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
  chatSettings: ChatSettings | null;
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
  useAgentStudioArtifacts(workspaceRepoPath, view.selectedTask);
  const { sessionReadModelLoadState } = useAgentSessionReadModelStateContext();
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

  const {
    runtimeReadiness,
    selectionForNewSession,
    selectedModelSelection,
    speed,
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
    selectedSession: view.selectedSession,
    role: view.role,
    reusablePrompts,
    repoSettings,
    favoriteState: agentModelFavoriteState,
    updateAgentSessionModel,
  });
  const selectedSession = useMemo(
    () =>
      view.selectedSession.identity === null &&
      view.selectedTask !== null &&
      selection.routeSessionResolution.kind === "none"
        ? {
            ...view.selectedSession,
            runtimeReadiness,
            transcriptState: deriveSessionlessTaskTranscriptState({
              readModelLoadState: sessionReadModelLoadState,
              runtimeReadinessState: runtimeReadiness.state,
            }),
          }
        : view.selectedSession,
    [
      runtimeReadiness,
      selection.routeSessionResolution.kind,
      sessionReadModelLoadState,
      view.selectedSession,
      view.selectedTask,
    ],
  );
  const agentStudioReady = selectedSession.runtimeReadiness.state === "ready";

  const {
    isStarting,
    sessionStartModal,
    humanReviewFeedbackModal,
    startSessionRequest,
    isSubmittingQuestionByRequestId,
    isSubmittingApprovalByRequestId,
    approvalReplyErrorByRequestId,
    isSessionWorking,
    isWaitingInput,
    messageDelivery,
    canUseKickoffPrompt,
    kickoffLabel,
    canStopSession,
    canResumeSession,
    isResumingSession,
    resumeSessionError,
    persistentResumeError,
    onResumeSession,
    startLaunchKickoff,
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
    isSelectionCatalogLoading,
    supportsAttachments,
    sessionsForTask: view.sessionsForTask,
    selectedTask: view.selectedTask,
    agentStudioReady,
    assertCanPrepareSession: actions.assertCanPrepareSession,
    isActiveTaskReady: view.isTaskReady,
    selectionForNewSession,
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
  const mergedTarget = useMergedTaskTarget(workspaceRepoPath, view.selectedTask);
  const selectedSessionContext = useMemo(
    () =>
      buildAgentStudioSelectedSessionContext({
        taskId: view.taskId,
        role: view.role,
        selectedTask: view.selectedTask,
        sessionsForTask: view.sessionsForTask,
        selectedSession,
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
        mergedTarget,
      }),
    [
      approvalReplyErrorByRequestId,
      gitProviderContext,
      gitProviderReadError,
      mergedTarget,
      isSessionWorking,
      isSubmittingApprovalByRequestId,
      isSubmittingQuestionByRequestId,
      onReplyApproval,
      onSubmitQuestionAnswers,
      roleLabelByRole,
      selectedSession,
      view,
    ],
  );

  const pageModelsArgs = buildAgentStudioPageModelsArgs({
    selectedSession: selectedSessionContext,
    sessionActions: {
      openTaskDetails: actions.openTaskDetails,
      runTaskQuickAction: actions.runTaskQuickAction,
      isStarting,
      isSessionWorking,
      isWaitingInput,
      messageDelivery,
      canUseKickoffPrompt,
      kickoffLabel,
      canStopSession,
      canResumeSession,
      isResumingSession,
      resumeSessionError,
      persistentResumeError,
      onResumeSession,
      startLaunchKickoff,
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
      speed,
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

  const artifactScope: Parameters<typeof useAgentStudioPageModels>[0]["artifactScope"] =
    workspaceRepoPath && view.taskId ? { repoPath: workspaceRepoPath, taskId: view.taskId } : null;
  if (artifactScope && activeWorkspaceId) artifactScope.workspaceId = activeWorkspaceId;
  if (artifactScope && view.selectedTask)
    artifactScope.artifactSummary = view.selectedTask.artifactSummary;
  const { agentStudioHeaderModel, taskExecutionDocumentPanelModel, agentChatModel } =
    useAgentStudioPageModels({ ...pageModelsArgs, artifactScope });

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
