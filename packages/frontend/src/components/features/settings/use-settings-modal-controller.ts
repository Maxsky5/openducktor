import type {
  BuiltinPromptRoleTabId,
  BuiltinPromptTemplateId as AgentPromptTemplateId,
} from "@openducktor/workflows";
import { useSettingsModalClaudePolicy } from "./use-settings-modal-claude-policy";
import { validateOpenCodePermissions } from "./opencode-permission-validation";
import type {
  AgentRuntimes,
  GitBranch,
  GitProviderRepository,
  SettingsRepoConfig,
  RepoPromptOverrides,
  ReusablePrompt,
  RuntimeDescriptor,
  RuntimeKind,
  SettingsSnapshot,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import type { RuntimeImpactReviewState } from "@/components/features/runtimes/runtime-impact-review";
import type { ModelPickerFavoriteState } from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { getAvailableRuntimeDefinitions } from "@openducktor/frontend-core/lib/agent-runtime";
import {
  useRequiredContext,
  useRuntimeAvailabilityContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import { invalidEnabledRuntime } from "@/state/operations/runtime-executables/runtime-executable-validation";
import type { RuntimeExecutableValidationState } from "@openducktor/frontend-core/queries/use-runtime-executable-validation";
import { useAgentModelFavorites } from "@openducktor/frontend-core/sessions/model-selection/use-agent-model-favorites";
import {
  validateCustomAgentRoleDrafts,
  type CustomAgentRoleValidationState,
} from "@/state/read-models/custom-agent-role-settings";
import type { RuntimeModelCatalogQueryResource } from "@openducktor/frontend-core/queries/use-runtime-model-catalogs";
import { buildNewCodexDangerousSelectionKey } from "./settings-codex-risk-policy";
import { validateGitProviderDrafts } from "./settings-modal-save-policy";
import type { SettingsSectionId } from "./settings-modal-constants";
import type { PromptValidationState } from "./settings-modal-controller.types";
import type { SettingsWorkspaceSelectionPolicy } from "./settings-workspace-selection";
import { useSettingsModalBranchesState } from "./use-settings-modal-branches-state";
import { useSettingsModalCatalogState } from "./use-settings-modal-catalog-state";
import { useSettingsModalDirtyDraftActions } from "./use-settings-modal-dirty-draft-actions";
import { useSettingsModalDirtyState } from "./use-settings-modal-dirty-state";
import { useSettingsModalDraftActions } from "./use-settings-modal-draft-actions";
import { useSettingsModalPromptValidation } from "./use-settings-modal-prompt-validation";
import { useSettingsModalRepositoryActions } from "./use-settings-modal-repository-actions";
import type { ReusablePromptValidationState } from "./use-settings-modal-reusable-prompt-validation";
import { useSettingsModalReusablePromptValidation } from "./use-settings-modal-reusable-prompt-validation";
import type { RuntimeAvailabilityValidationState } from "./use-settings-modal-runtime-validation";
import { useSettingsModalRuntimeValidation } from "./use-settings-modal-runtime-validation";
import { useSettingsModalSaveOrchestration } from "./use-settings-modal-save-orchestration";
import { useSettingsModalSnapshotState } from "./use-settings-modal-snapshot-state";
import { useSettingsRuntimeExecutableSetup } from "./use-settings-runtime-executable-setup";

export type SettingsModalController = {
  customAgentRoleValidationState: CustomAgentRoleValidationState;
  updateCustomAgentRoles: (
    updater: (
      current: SettingsSnapshot["customAgentRoles"],
    ) => SettingsSnapshot["customAgentRoles"],
  ) => void;
  isLoadingSettings: boolean;
  isLoadingRuntimeDefinitions: boolean;
  isLoadingRuntimeExecutables: boolean;
  isCheckingRuntimeExecutables: boolean;
  isLoadingCatalog: boolean;
  isSaving: boolean;
  runtimeReview: RuntimeImpactReviewState | null;
  confirmRuntimeReview: () => void;
  cancelRuntimeReview: () => void;
  settingsError: string | null;
  runtimeDefinitionsError: string | null;
  runtimeExecutablesError: string | null;
  runtimeDiscoveryError: string | null;
  runtimeExecutableValidation: RuntimeExecutableValidationState;
  saveError: string | null;
  snapshotDraft: SettingsSnapshot | null;
  runtimeDefinitions: RuntimeDescriptor[];
  availableRuntimeDefinitions: RuntimeDescriptor[];
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  getCatalogErrorForRuntime: (runtimeKind: RuntimeKind) => string | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  catalogResources: RuntimeModelCatalogQueryResource[];
  favoriteState: ModelPickerFavoriteState;
  workspaces: WorkspaceRecord[];
  workspaceIds: string[];
  selectedWorkspaceId: string | null;
  selectedRepoConfig: SettingsRepoConfig | null;
  requiredWorkspaceSelectionUnresolved: boolean;
  requiredWorkspaceRepoPath: string | null;
  selectedWorkspace: WorkspaceRecord | null;
  selectedRepoDefaultWorktreeBasePath: string | null;
  selectedRepoEffectiveWorktreeBasePath: string | null;
  selectedRepoBranches: GitBranch[];
  isLoadingSelectedRepoBranches: boolean;
  selectedRepoBranchesError: string | null;
  promptValidationState: PromptValidationState;
  openCodePermissionErrorCount: number;
  hasPromptValidationErrors: boolean;
  selectedRepoPromptValidationErrors: Partial<Record<AgentPromptTemplateId, string>>;
  selectedRepoPromptValidationErrorCount: number;
  globalPromptRoleTabErrorCounts: Record<BuiltinPromptRoleTabId, number>;
  selectedRepoPromptRoleTabErrorCounts: Record<BuiltinPromptRoleTabId, number>;
  settingsSectionErrorCountById: Record<SettingsSectionId, number>;
  reusablePromptValidationState: ReusablePromptValidationState;
  hasReusablePromptValidationErrors: boolean;
  runtimeAvailabilityValidationState: RuntimeAvailabilityValidationState;
  hasRuntimeAvailabilityErrors: boolean;
  hasUnacknowledgedCodexDangerousSettings: boolean;
  claudeSettingsSaveError: string | null;
  requiresClaudeDangerAcknowledgement: boolean;
  isClaudeDangerAcknowledged: boolean;
  setClaudeDangerAcknowledged: (value: boolean) => void;
  requiresCodexDangerAcknowledgement: boolean;
  isCodexDangerAcknowledged: boolean;
  selectedRepoModelWarnings: string[];
  setSelectedWorkspaceId: (next: string) => void;
  retrySelectedRepoBranchesLoad: () => void;
  retrySettings: () => void;
  retryRuntimeDefinitions: () => Promise<RuntimeDescriptor[]>;
  checkRuntimeExecutablesAgain: () => Promise<void>;
  detectSelectedRepoGithubRepository: () => Promise<GitProviderRepository | null>;
  setGitProviderValidationErrorCount: (errorCount: number) => void;
  updateSelectedRepoConfig: (updater: (current: SettingsRepoConfig) => SettingsRepoConfig) => void;
  updateGlobalGitConfig: (
    updater: (current: SettingsSnapshot["git"]) => SettingsSnapshot["git"],
  ) => void;
  updateGlobalChatSettings: (
    updater: (current: SettingsSnapshot["chat"]) => SettingsSnapshot["chat"],
  ) => void;
  updateGlobalSystemSettings: (
    updater: (current: SettingsSnapshot["system"]) => SettingsSnapshot["system"],
  ) => void;
  updateNotificationSettings: (
    updater: (current: SettingsSnapshot["notifications"]) => SettingsSnapshot["notifications"],
  ) => void;
  updateGlobalGeneralSettings: (
    updater: (current: SettingsSnapshot["general"]) => SettingsSnapshot["general"],
  ) => void;
  updateGlobalAppearanceSettings: (
    updater: (current: SettingsSnapshot["appearance"]) => SettingsSnapshot["appearance"],
  ) => void;
  updateAgentRuntimes: (updater: (current: AgentRuntimes) => AgentRuntimes) => void;
  setCodexDangerAcknowledged: (acknowledged: boolean) => void;
  updateReusablePrompts: (updater: (current: ReusablePrompt[]) => ReusablePrompt[]) => void;
  updateGlobalKanbanSettings: (
    updater: (current: SettingsSnapshot["kanban"]) => SettingsSnapshot["kanban"],
  ) => void;
  updateGlobalAutopilotSettings: (
    updater: (current: SettingsSnapshot["autopilot"]) => SettingsSnapshot["autopilot"],
  ) => void;
  /** The saved Autopilot rules could not load, so the shown rules can be old. */
  savedAutopilotError: string | null;
  updateGlobalPromptOverrides: (
    updater: (current: RepoPromptOverrides) => RepoPromptOverrides,
  ) => void;
  updateRepoPromptOverrides: (
    updater: (current: RepoPromptOverrides) => RepoPromptOverrides,
  ) => void;
  updateSelectedRepoAgentDefault: (
    role: "spec" | "planner" | "build" | "qa",
    field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
    value: string,
  ) => void;
  clearSelectedRepoAgentDefault: (role: "spec" | "planner" | "build" | "qa") => void;
  updateSelectedRepoDefaultModel: (
    field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
    value: string,
  ) => void;
  clearSelectedRepoDefaultModel: () => void;
  submit: () => Promise<boolean>;
  discardDraft: () => void;
  retainDraft: () => void;
};

type UseSettingsModalControllerArgs = {
  open: boolean;
  shouldLoadCatalog: boolean;
  workspaceSelectionPolicy?: SettingsWorkspaceSelectionPolicy | undefined;
  onRuntimeAvailabilityError: (runtimeKind: RuntimeKind) => void;
};

export const useSettingsModalController = ({
  open,
  shouldLoadCatalog,
  workspaceSelectionPolicy,
  onRuntimeAvailabilityError,
}: UseSettingsModalControllerArgs): SettingsModalController => {
  const workspaceState = useRequiredContext(WorkspaceStateContext, "useSettingsModalController");
  const {
    activeWorkspace,
    workspaces,
    detectGithubRepository,
    saveAgentModelFavorites,
    previewSettingsSnapshotRuntime,
    saveSettingsSnapshot,
  } = workspaceState;
  const favoriteState = useAgentModelFavorites({ saveAgentModelFavorites });
  const workspacePolicy = useWorkspacePolicy(
    activeWorkspace?.repoPath ?? null,
    workspaceSelectionPolicy,
  );
  const {
    allRuntimeDefinitions: runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    refreshRuntimeDefinitions,
  } = useRuntimeAvailabilityContext();

  const {
    loadedSnapshot,
    draftBaseline,
    unavailableTargetError,
    discardDraft,
    snapshotDraft,
    setSnapshotDraft,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    workspaceIds,
    selectedRepoConfig,
    isLoadingSettings,
    settingsError,
    retrySettings,
    acknowledgeSave,
    retainDraft,
    requiredWorkspaceSelectionUnresolved,
    requiredWorkspaceRepoPath,
  } = useSettingsModalSnapshotState({
    open,
    workspaceSelectionPolicy: workspacePolicy,
  });
  const {
    gitProviderValidationErrorCount,
    gitProviderInvalidWorkspaceIds,
    setGitProviderValidationErrorCount,
  } = useGitProviderValidation({ loadedSnapshot, snapshotDraft, selectedWorkspaceId });

  const selectedWorkspace = useMemo(
    () =>
      selectedWorkspaceId
        ? (workspaces.find((workspace) => workspace.workspaceId === selectedWorkspaceId) ?? null)
        : null,
    [selectedWorkspaceId, workspaces],
  );
  const selectedWorkspaceRepoPath = selectedWorkspace?.repoPath ?? null;

  const {
    selectedRepoBranches,
    isLoadingSelectedRepoBranches,
    selectedRepoBranchesError,
    retrySelectedRepoBranchesLoad,
  } = useSettingsModalBranchesState({
    open,
    selectedRepoPath: selectedWorkspaceRepoPath,
  });

  const availableRuntimeDefinitions = useMemo(
    () =>
      snapshotDraft
        ? getAvailableRuntimeDefinitions({
            runtimeDefinitions,
            agentRuntimes: snapshotDraft.agentRuntimes,
          })
        : [],
    [runtimeDefinitions, snapshotDraft],
  );
  const runtimeExecutableSetup = useSettingsRuntimeExecutableSetup({
    open,
    runtimes: snapshotDraft?.agentRuntimes ?? null,
  });
  const runtimeExecutableValidation = runtimeExecutableSetup.validation;
  const isLoadingRuntimeExecutables = runtimeExecutableSetup.isLoading;
  const isCheckingRuntimeExecutables = runtimeExecutableSetup.isCheckingDiscovery;
  const runtimeDiscoveryError = runtimeExecutableSetup.discoveryError;
  const runtimeExecutablesError = runtimeExecutableSetup.error;
  const runtimeRequestError = runtimeDefinitionsError ?? runtimeExecutablesError;
  const catalogRuntimeKinds = useMemo(
    () => availableRuntimeDefinitions.map((runtime) => runtime.kind),
    [availableRuntimeDefinitions],
  );

  const {
    resources: catalogResources,
    getCatalogForRuntime,
    getCatalogErrorForRuntime,
    isCatalogLoadingForRuntime,
    isLoadingCatalog,
  } = useSettingsModalCatalogState({
    enabled: shouldLoadCatalog,
    selectedRepoPath: selectedWorkspaceRepoPath,
    runtimeKinds: catalogRuntimeKinds,
  });

  const {
    promptValidationState,
    hasPromptValidationErrors,
    selectedRepoPromptValidationErrors,
    selectedRepoPromptValidationErrorCount,
    globalPromptRoleTabErrorCounts,
    selectedRepoPromptRoleTabErrorCounts,
    settingsSectionErrorCountById,
  } = useSettingsModalPromptValidation({
    snapshotDraft,
    selectedWorkspaceId,
  });
  const reusablePromptValidationState = useSettingsModalReusablePromptValidation({ snapshotDraft });
  const customAgentRoleValidationState = useMemo(
    () => validateCustomAgentRoleDrafts(snapshotDraft?.customAgentRoles ?? []),
    [snapshotDraft?.customAgentRoles],
  );
  const hasReusablePromptValidationErrors = reusablePromptValidationState.totalErrorCount > 0;
  const {
    runtimeAvailabilityValidationState,
    hasRuntimeAvailabilityErrors,
    invalidRuntimeKind,
    selectedRepoModelWarnings,
  } = useRuntimeState({
    runtimeDefinitions,
    snapshotDraft,
    runtimeExecutableValidation,
    selectedWorkspaceId,
  });
  const {
    hasUnacknowledgedCodexDangerousSettings,
    requiresCodexDangerAcknowledgement,
    isCodexDangerAcknowledged,
    setCodexDangerAcknowledged,
    requiresClaudeDangerAcknowledgement,
    isClaudeDangerAcknowledged,
    setClaudeDangerAcknowledged,
    claudeSettingsSaveError,
    claudeValidationError,
  } = useRuntimePolicyState({ open, loadedSnapshot, snapshotDraft });
  const {
    updateSelectedRepoConfig: applySelectedRepoConfigUpdate,
    updateGlobalGitConfig: applyGlobalGitConfigUpdate,
    updateGlobalChatSettings: applyGlobalChatSettingsUpdate,
    updateGlobalSystemSettings: applyGlobalSystemSettingsUpdate,
    updateNotificationSettings: applyNotificationSettingsUpdate,
    updateGlobalGeneralSettings: applyGlobalGeneralSettingsUpdate,
    updateGlobalAppearanceSettings: applyGlobalAppearanceSettingsUpdate,
    updateAgentRuntimes: applyAgentRuntimesUpdate,
    updateReusablePrompts: applyReusablePromptsUpdate,
    updateCustomAgentRoles: applyCustomAgentRolesUpdate,
    updateGlobalKanbanSettings: applyGlobalKanbanSettingsUpdate,
    updateGlobalAutopilotSettings: applyGlobalAutopilotSettingsUpdate,
    updateGlobalPromptOverrides: applyGlobalPromptOverridesUpdate,
    updateRepoPromptOverrides: applyRepoPromptOverridesUpdate,
    updateSelectedRepoAgentDefault: applySelectedRepoAgentDefaultUpdate,
    clearSelectedRepoAgentDefault: applyClearSelectedRepoAgentDefault,
    updateSelectedRepoDefaultModel: applySelectedRepoDefaultModelUpdate,
    clearSelectedRepoDefaultModel: applyClearSelectedRepoDefaultModel,
  } = useSettingsModalDraftActions({
    selectedWorkspaceId,
    setSnapshotDraft,
  });
  const { dirtySections } = useSettingsModalDirtyState({
    open,
    baseline: draftBaseline,
    draft: snapshotDraft,
  });

  const savedAutopilotError = settingsError;

  const selectedRepoDefaultWorktreeBasePath = selectedWorkspace?.defaultWorktreeBasePath ?? null;
  const selectedRepoEffectiveWorktreeBasePath = useMemo(
    () => selectedRepoConfig?.worktreeBasePath?.trim() || selectedRepoDefaultWorktreeBasePath,
    [selectedRepoConfig?.worktreeBasePath, selectedRepoDefaultWorktreeBasePath],
  );
  const settingsSectionErrorCountByIdWithValidation = useMemo(
    () => ({
      ...settingsSectionErrorCountById,
      repositories: settingsSectionErrorCountById.repositories + gitProviderValidationErrorCount,
      runtimes: runtimeAvailabilityValidationState.runtimeExecutableErrors.length,
      "reusable-prompts": reusablePromptValidationState.totalErrorCount,
      "custom-agent-roles": customAgentRoleValidationState.totalErrorCount,
    }),
    [
      gitProviderValidationErrorCount,
      reusablePromptValidationState.totalErrorCount,
      customAgentRoleValidationState.totalErrorCount,
      runtimeAvailabilityValidationState.runtimeExecutableErrors.length,
      settingsSectionErrorCountById,
    ],
  );

  const openCodePermissionErrors = validateOpenCodePermissions(
    snapshotDraft?.agentRuntimes.opencode,
  );
  const {
    runtimeReview,
    confirmRuntimeReview,
    cancelRuntimeReview,
    isSaving,
    saveError,
    clearSaveError,
    submit,
  } = useSettingsModalSaveOrchestration({
    open,
    loadedSnapshot: draftBaseline,
    unavailableTargetError,
    snapshotDraft,
    dirtySections,
    validation: {
      openCodePermissions: openCodePermissionErrors,
      gitProvider: {
        hasErrors: gitProviderValidationErrorCount > 0,
        errorCount: gitProviderValidationErrorCount,
        invalidWorkspaceIds: gitProviderInvalidWorkspaceIds,
        selectedWorkspaceId,
      },
      customAgentRoles: {
        hasErrors: customAgentRoleValidationState.totalErrorCount > 0,
        errorCount: customAgentRoleValidationState.totalErrorCount,
      },
      prompt: {
        hasErrors: hasPromptValidationErrors,
        errorCount: promptValidationState.totalErrorCount,
      },
      reusablePrompts: {
        hasErrors: hasReusablePromptValidationErrors,
        errorCount: reusablePromptValidationState.totalErrorCount,
      },
      runtimeRequest: {
        isPending: isLoadingRuntimeDefinitions || isLoadingRuntimeExecutables,
        error: runtimeRequestError,
      },
      runtimeAvailability: {
        hasErrors: hasRuntimeAvailabilityErrors,
        errorCount: runtimeAvailabilityValidationState.totalErrorCount,
        invalidKind: invalidRuntimeKind,
      },
      hasUnacknowledgedCodexDangerousSettings,
      claude: {
        error: claudeValidationError,
        unacknowledged: requiresClaudeDangerAcknowledgement && !isClaudeDangerAcknowledged,
      },
    },
    onRuntimeAvailabilityError,
    previewSettingsSnapshotRuntime,
    saveSettingsSnapshot,
    acknowledgeSave,
    retainDraft,
  });
  const draftActions = useMemo(
    () => ({
      updateSelectedRepoConfig: applySelectedRepoConfigUpdate,
      updateGlobalGitConfig: applyGlobalGitConfigUpdate,
      updateGlobalChatSettings: applyGlobalChatSettingsUpdate,
      updateGlobalSystemSettings: applyGlobalSystemSettingsUpdate,
      updateNotificationSettings: applyNotificationSettingsUpdate,
      updateGlobalGeneralSettings: applyGlobalGeneralSettingsUpdate,
      updateGlobalAppearanceSettings: applyGlobalAppearanceSettingsUpdate,
      updateAgentRuntimes: applyAgentRuntimesUpdate,
      updateReusablePrompts: applyReusablePromptsUpdate,
      updateCustomAgentRoles: applyCustomAgentRolesUpdate,
      updateGlobalKanbanSettings: applyGlobalKanbanSettingsUpdate,
      updateGlobalAutopilotSettings: applyGlobalAutopilotSettingsUpdate,
      updateGlobalPromptOverrides: applyGlobalPromptOverridesUpdate,
      updateRepoPromptOverrides: applyRepoPromptOverridesUpdate,
      updateSelectedRepoAgentDefault: applySelectedRepoAgentDefaultUpdate,
      clearSelectedRepoAgentDefault: applyClearSelectedRepoAgentDefault,
      updateSelectedRepoDefaultModel: applySelectedRepoDefaultModelUpdate,
      clearSelectedRepoDefaultModel: applyClearSelectedRepoDefaultModel,
    }),
    [
      applySelectedRepoConfigUpdate,
      applyGlobalGitConfigUpdate,
      applyGlobalChatSettingsUpdate,
      applyGlobalSystemSettingsUpdate,
      applyNotificationSettingsUpdate,
      applyGlobalGeneralSettingsUpdate,
      applyGlobalAppearanceSettingsUpdate,
      applyAgentRuntimesUpdate,
      applyReusablePromptsUpdate,
      applyCustomAgentRolesUpdate,
      applyGlobalKanbanSettingsUpdate,
      applyGlobalAutopilotSettingsUpdate,
      applyGlobalPromptOverridesUpdate,
      applyRepoPromptOverridesUpdate,
      applySelectedRepoAgentDefaultUpdate,
      applyClearSelectedRepoAgentDefault,
      applySelectedRepoDefaultModelUpdate,
      applyClearSelectedRepoDefaultModel,
    ],
  );
  const {
    updateSelectedRepoConfig,
    updateGlobalGitConfig,
    updateGlobalChatSettings,
    updateGlobalSystemSettings,
    updateNotificationSettings,
    updateGlobalGeneralSettings,
    updateGlobalAppearanceSettings,
    updateAgentRuntimes,
    updateReusablePrompts,
    updateCustomAgentRoles,
    updateGlobalKanbanSettings,
    updateGlobalAutopilotSettings,
    updateGlobalPromptOverrides,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
    updateSelectedRepoDefaultModel,
    clearSelectedRepoDefaultModel,
  } = useSettingsModalDirtyDraftActions({
    clearSaveError,
    draftActions,
  });
  const { checkAgain: checkRuntimeExecutables } = runtimeExecutableSetup;
  const checkRuntimeExecutablesAgain = useCallback(
    () => checkRuntimeExecutables(updateAgentRuntimes),
    [checkRuntimeExecutables, updateAgentRuntimes],
  );

  const { detectSelectedRepoGithubRepository } = useSettingsModalRepositoryActions({
    selectedWorkspace,
    detectGithubRepository,
    updateSelectedRepoConfig,
  });

  return {
    customAgentRoleValidationState,
    updateCustomAgentRoles,
    isLoadingSettings,
    isLoadingRuntimeDefinitions,
    isLoadingRuntimeExecutables,
    isCheckingRuntimeExecutables,
    isLoadingCatalog,
    isSaving,
    settingsError,
    runtimeDefinitionsError,
    runtimeExecutablesError,
    runtimeDiscoveryError,
    runtimeExecutableValidation,
    saveError,
    snapshotDraft,
    runtimeDefinitions,
    availableRuntimeDefinitions,
    getCatalogForRuntime,
    getCatalogErrorForRuntime,
    isCatalogLoadingForRuntime,
    catalogResources,
    favoriteState,
    workspaces,
    workspaceIds,
    selectedWorkspaceId,
    selectedRepoConfig,
    requiredWorkspaceSelectionUnresolved,
    requiredWorkspaceRepoPath,
    selectedWorkspace,
    selectedRepoDefaultWorktreeBasePath,
    selectedRepoEffectiveWorktreeBasePath,
    selectedRepoBranches,
    isLoadingSelectedRepoBranches,
    selectedRepoBranchesError,
    promptValidationState,
    openCodePermissionErrorCount: openCodePermissionErrors.length,
    hasPromptValidationErrors,
    selectedRepoPromptValidationErrors,
    selectedRepoPromptValidationErrorCount,
    globalPromptRoleTabErrorCounts,
    selectedRepoPromptRoleTabErrorCounts,
    settingsSectionErrorCountById: settingsSectionErrorCountByIdWithValidation,
    reusablePromptValidationState,
    hasReusablePromptValidationErrors,
    runtimeAvailabilityValidationState,
    hasRuntimeAvailabilityErrors,
    hasUnacknowledgedCodexDangerousSettings,
    claudeSettingsSaveError,
    requiresClaudeDangerAcknowledgement,
    isClaudeDangerAcknowledged,
    setClaudeDangerAcknowledged,
    requiresCodexDangerAcknowledgement,
    isCodexDangerAcknowledged,
    selectedRepoModelWarnings,
    setSelectedWorkspaceId,
    retrySelectedRepoBranchesLoad,
    retrySettings,
    retryRuntimeDefinitions: refreshRuntimeDefinitions,
    checkRuntimeExecutablesAgain,
    detectSelectedRepoGithubRepository,
    setGitProviderValidationErrorCount,
    updateSelectedRepoConfig,
    updateGlobalGitConfig,
    updateGlobalChatSettings,
    updateGlobalSystemSettings,
    updateNotificationSettings,
    updateGlobalGeneralSettings,
    updateGlobalAppearanceSettings,
    updateAgentRuntimes,
    setCodexDangerAcknowledged,
    updateReusablePrompts,
    updateGlobalKanbanSettings,
    updateGlobalAutopilotSettings,
    savedAutopilotError,
    updateGlobalPromptOverrides,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
    updateSelectedRepoDefaultModel,
    clearSelectedRepoDefaultModel,
    runtimeReview,
    confirmRuntimeReview,
    cancelRuntimeReview,
    submit,
    discardDraft,
    retainDraft,
  };
};

const useGitProviderValidation = ({
  loadedSnapshot,
  snapshotDraft,
  selectedWorkspaceId,
}: {
  loadedSnapshot: SettingsSnapshot | null;
  snapshotDraft: SettingsSnapshot | null;
  selectedWorkspaceId: string | null;
}) => {
  const [reported, setReported] = useState<{
    snapshot: SettingsSnapshot | null;
    workspaceId: string | null;
    errorCount: number;
  }>({ snapshot: null, workspaceId: null, errorCount: 0 });
  const setGitProviderValidationErrorCount = useCallback(
    (errorCount: number): void => {
      setReported({ snapshot: loadedSnapshot, workspaceId: selectedWorkspaceId, errorCount });
    },
    [loadedSnapshot, selectedWorkspaceId],
  );
  const reportedErrorCount =
    reported.snapshot === loadedSnapshot && reported.workspaceId === selectedWorkspaceId
      ? reported.errorCount
      : 0;
  const validation = validateGitProviderDrafts(
    snapshotDraft,
    selectedWorkspaceId,
    reportedErrorCount,
  );
  return {
    gitProviderValidationErrorCount: validation.errorCount,
    gitProviderInvalidWorkspaceIds: validation.invalidWorkspaceIds,
    setGitProviderValidationErrorCount,
  };
};

type CodexDangerState = Pick<
  SettingsModalController,
  | "hasUnacknowledgedCodexDangerousSettings"
  | "requiresCodexDangerAcknowledgement"
  | "isCodexDangerAcknowledged"
  | "setCodexDangerAcknowledged"
>;

const useCodexDangerState = ({
  open,
  baseline,
  draft,
}: {
  open: boolean;
  baseline: AgentRuntimes["codex"] | null;
  draft: AgentRuntimes["codex"] | null;
}): CodexDangerState => {
  const key = useMemo(
    () => (open && draft ? buildNewCodexDangerousSelectionKey({ baseline, draft }) : ""),
    [baseline, draft, open],
  );
  const [acknowledgedKey, setAcknowledgedKey] = useState("");
  if (acknowledgedKey && acknowledgedKey !== key) {
    setAcknowledgedKey("");
  }

  const requiresCodexDangerAcknowledgement = key !== "";
  const isCodexDangerAcknowledged = requiresCodexDangerAcknowledgement && acknowledgedKey === key;
  const setCodexDangerAcknowledged = useCallback(
    (acknowledged: boolean): void => setAcknowledgedKey(acknowledged ? key : ""),
    [key],
  );

  return {
    hasUnacknowledgedCodexDangerousSettings:
      requiresCodexDangerAcknowledgement && !isCodexDangerAcknowledged,
    requiresCodexDangerAcknowledgement,
    isCodexDangerAcknowledged,
    setCodexDangerAcknowledged,
  };
};

const useWorkspacePolicy = (
  activeRepoPath: string | null,
  policy: SettingsWorkspaceSelectionPolicy | undefined,
): SettingsWorkspaceSelectionPolicy => {
  const kind = policy?.kind ?? "preferred";
  const repoPath = policy === undefined ? activeRepoPath : policy.repoPath;
  return useMemo(() => ({ kind, repoPath }), [kind, repoPath]);
};

const useRuntimeState = ({
  runtimeDefinitions,
  snapshotDraft,
  runtimeExecutableValidation,
  selectedWorkspaceId,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  snapshotDraft: SettingsSnapshot | null;
  runtimeExecutableValidation: RuntimeExecutableValidationState;
  selectedWorkspaceId: string | null;
}) => {
  const input: Parameters<typeof useSettingsModalRuntimeValidation>[0] = {
    runtimeDefinitions,
    snapshotDraft,
    checkingRuntimeKinds: runtimeExecutableValidation.checkingRuntimeKinds,
  };
  if (runtimeExecutableValidation.results.length > 0) {
    input.runtimeExecutableResults = runtimeExecutableValidation.results;
  }

  const validation = useSettingsModalRuntimeValidation(input);
  const invalidRuntimeKind = snapshotDraft
    ? (invalidEnabledRuntime(snapshotDraft.agentRuntimes, runtimeExecutableValidation.results)
        ?.kind ?? null)
    : null;
  const selectedRepoModelWarnings = selectedWorkspaceId
    ? (validation.warningsByWorkspaceId[selectedWorkspaceId] ?? [])
    : [];

  return {
    runtimeAvailabilityValidationState: validation,
    hasRuntimeAvailabilityErrors: validation.totalErrorCount > 0,
    invalidRuntimeKind,
    selectedRepoModelWarnings,
  };
};

const useRuntimePolicyState = ({
  open,
  loadedSnapshot,
  snapshotDraft,
}: {
  open: boolean;
  loadedSnapshot: SettingsSnapshot | null;
  snapshotDraft: SettingsSnapshot | null;
}) => {
  const codex = useCodexDangerState({
    open,
    baseline: loadedSnapshot?.agentRuntimes.codex ?? null,
    draft: snapshotDraft?.agentRuntimes.codex ?? null,
  });
  const claude = useSettingsModalClaudePolicy({
    open,
    baseline: loadedSnapshot?.agentRuntimes.claude ?? null,
    draft: snapshotDraft?.agentRuntimes.claude ?? null,
  });
  return { ...codex, ...claude };
};
