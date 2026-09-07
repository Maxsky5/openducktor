import type {
  AgentPromptTemplateId,
  AgentRuntimes,
  GitBranch,
  GitProviderRepository,
  SettingsRepoConfig,
  RepoPromptOverrides,
  ReusablePrompt,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
  SettingsSnapshot,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useIsMutating } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { ModelPickerFavoriteState } from "@/components/features/agents/model-picker";
import { getAvailableRuntimeDefinitions } from "@/lib/agent-runtime";
import {
  ChecksStateContext,
  useRequiredContext,
  useRuntimeAvailabilityContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import { invalidEnabledRuntime } from "@/state/operations/runtime-executables/runtime-executable-validation";
import type { RuntimeExecutableValidationState } from "@/state/queries/use-runtime-executable-validation";
import { AGENT_MODEL_FAVORITES_MUTATION_KEY } from "@/state/mutations/agent-model-favorites";
import { useAgentModelFavorites } from "@/state/mutations/use-agent-model-favorites";
import type { RuntimeModelCatalogQueryResource } from "@/state/queries/use-runtime-model-catalogs";
import { buildNewCodexDangerousSelectionKey } from "./settings-codex-risk-policy";
import type { PromptRoleTabId, SettingsSectionId } from "./settings-modal-constants";
import type { PromptValidationState } from "./settings-modal-controller.types";
import type { SettingsWorkspaceSelectionPolicy } from "./settings-workspace-selection";
import { useSettingsModalBranchesState } from "./use-settings-modal-branches-state";
import { useSettingsModalCatalogState } from "./use-settings-modal-catalog-state";
import { useSettingsModalDirtyDraftActions } from "./use-settings-modal-dirty-draft-actions";
import { useSettingsModalDirtyState } from "./use-settings-modal-dirty-state";
import { useSettingsModalDraftActions } from "./use-settings-modal-draft-actions";
import { useSettingsModalPromptValidation } from "./use-settings-modal-prompt-validation";
import { useSettingsModalRepoScriptValidation } from "./use-settings-modal-repo-script-validation";
import { useSettingsModalRepositoryActions } from "./use-settings-modal-repository-actions";
import type { ReusablePromptValidationState } from "./use-settings-modal-reusable-prompt-validation";
import { useSettingsModalReusablePromptValidation } from "./use-settings-modal-reusable-prompt-validation";
import type { RuntimeAvailabilityValidationState } from "./use-settings-modal-runtime-validation";
import { useSettingsModalRuntimeValidation } from "./use-settings-modal-runtime-validation";
import { useSettingsModalSaveOrchestration } from "./use-settings-modal-save-orchestration";
import { useSettingsModalSnapshotState } from "./use-settings-modal-snapshot-state";
import { useSettingsRuntimeExecutableSetup } from "./use-settings-runtime-executable-setup";

export type SettingsModalController = {
  isLoadingSettings: boolean;
  isLoadingRuntimeDefinitions: boolean;
  isLoadingRuntimeExecutables: boolean;
  isCheckingRuntimeExecutables: boolean;
  isLoadingCatalog: boolean;
  isSaving: boolean;
  settingsError: string | null;
  runtimeDefinitionsError: string | null;
  runtimeExecutablesError: string | null;
  runtimeDiscoveryError: string | null;
  runtimeExecutableValidation: RuntimeExecutableValidationState;
  saveError: string | null;
  snapshotDraft: SettingsSnapshot | null;
  runtimeDefinitions: RuntimeDescriptor[];
  availableRuntimeDefinitions: RuntimeDescriptor[];
  runtimeCheck: RuntimeCheck | null;
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
  hasPromptValidationErrors: boolean;
  selectedRepoPromptValidationErrors: Partial<Record<AgentPromptTemplateId, string>>;
  selectedRepoPromptValidationErrorCount: number;
  globalPromptRoleTabErrorCounts: Record<PromptRoleTabId, number>;
  selectedRepoPromptRoleTabErrorCounts: Record<PromptRoleTabId, number>;
  settingsSectionErrorCountById: Record<SettingsSectionId, number>;
  reusablePromptValidationState: ReusablePromptValidationState;
  hasReusablePromptValidationErrors: boolean;
  runtimeAvailabilityValidationState: RuntimeAvailabilityValidationState;
  hasRuntimeAvailabilityErrors: boolean;
  hasUnacknowledgedCodexDangerousSettings: boolean;
  requiresCodexDangerAcknowledgement: boolean;
  isCodexDangerAcknowledged: boolean;
  selectedRepoRuntimeAvailabilityErrors: string[];
  selectedRepoRuntimeAvailabilityErrorCount: number;
  hasRepoScriptValidationErrors: boolean;
  repoScriptValidationErrorCountByWorkspaceId: Record<string, number>;
  repoScriptValidationErrorCount: number;
  showRepoScriptValidationErrors: boolean;
  selectedRepoDevServerValidationErrors: Record<string, { name?: string; command?: string }>;
  setSelectedWorkspaceId: (next: string) => void;
  markRepoScriptSaveAttempt: () => void;
  retrySelectedRepoBranchesLoad: () => void;
  retryRuntimeDefinitions: () => Promise<RuntimeDescriptor[]>;
  checkRuntimeExecutablesAgain: () => Promise<void>;
  detectSelectedRepoGithubRepository: () => Promise<GitProviderRepository | null>;
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
  submit: () => Promise<boolean>;
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
  const checksState = useRequiredContext(ChecksStateContext, "useSettingsModalController");
  const {
    activeWorkspace,
    workspaces,
    loadSettingsSnapshot,
    detectGithubRepository,
    saveGlobalGitConfig,
    saveAgentModelFavorites,
    saveSettingsSnapshot,
  } = workspaceState;
  const favoriteState = useAgentModelFavorites({ saveAgentModelFavorites });
  const isAgentModelFavoritesMutationPending =
    useIsMutating({ mutationKey: AGENT_MODEL_FAVORITES_MUTATION_KEY }) > 0;
  const workspacePolicy = useWorkspacePolicy(
    activeWorkspace?.repoPath ?? null,
    workspaceSelectionPolicy,
  );
  const { runtimeCheck } = checksState;
  const {
    allRuntimeDefinitions: runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
    refreshRuntimeDefinitions,
  } = useRuntimeAvailabilityContext();

  const {
    loadedSnapshot,
    snapshotDraft,
    setSnapshotDraft,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    workspaceIds,
    selectedRepoConfig,
    isLoadingSettings,
    settingsError,
    clearSettingsError,
    requiredWorkspaceSelectionUnresolved,
    requiredWorkspaceRepoPath,
  } = useSettingsModalSnapshotState({
    open,
    workspaceSelectionPolicy: workspacePolicy,
    loadSettingsSnapshot,
  });

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
  const hasReusablePromptValidationErrors = reusablePromptValidationState.totalErrorCount > 0;
  const {
    runtimeAvailabilityValidationState,
    hasRuntimeAvailabilityErrors,
    invalidRuntimeKind,
    selectedRepoRuntimeAvailabilityErrors,
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
  } = useCodexDangerState({
    open,
    baseline: loadedSnapshot?.agentRuntimes.codex ?? null,
    draft: snapshotDraft?.agentRuntimes.codex ?? null,
  });
  const selectedRepoRuntimeAvailabilityErrorCount = selectedRepoRuntimeAvailabilityErrors.length;
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
    updateGlobalKanbanSettings: applyGlobalKanbanSettingsUpdate,
    updateGlobalAutopilotSettings: applyGlobalAutopilotSettingsUpdate,
    updateGlobalPromptOverrides: applyGlobalPromptOverridesUpdate,
    updateRepoPromptOverrides: applyRepoPromptOverridesUpdate,
    updateSelectedRepoAgentDefault: applySelectedRepoAgentDefaultUpdate,
    clearSelectedRepoAgentDefault: applyClearSelectedRepoAgentDefault,
  } = useSettingsModalDraftActions({
    selectedWorkspaceId,
    setSnapshotDraft,
  });

  const { dirtySections, markDirty } = useSettingsModalDirtyState({
    open,
    loadedSnapshot,
  });

  const selectedRepoDefaultWorktreeBasePath = selectedWorkspace?.defaultWorktreeBasePath ?? null;
  const selectedRepoEffectiveWorktreeBasePath = useMemo(() => {
    const draftWorktreeBasePath = selectedRepoConfig?.worktreeBasePath?.trim();
    if (draftWorktreeBasePath) {
      return draftWorktreeBasePath;
    }

    return selectedRepoDefaultWorktreeBasePath;
  }, [selectedRepoConfig?.worktreeBasePath, selectedRepoDefaultWorktreeBasePath]);
  const {
    selectedRepoDevServerValidationErrors,
    invalidRepoPathsWithDevServerErrors,
    repoScriptValidationErrorCountByWorkspaceId,
    repoScriptValidationErrorCount,
    hasRepoScriptValidationErrors,
  } = useSettingsModalRepoScriptValidation({
    snapshotDraft,
    selectedRepoConfig,
  });
  const settingsSectionErrorCountByIdWithValidation = useMemo(
    () => ({
      ...settingsSectionErrorCountById,
      repositories:
        settingsSectionErrorCountById.repositories +
        runtimeAvailabilityValidationState.totalErrorCount -
        runtimeAvailabilityValidationState.runtimeExecutableErrors.length +
        repoScriptValidationErrorCount,
      runtimes: runtimeAvailabilityValidationState.runtimeExecutableErrors.length,
      "reusable-prompts": reusablePromptValidationState.totalErrorCount,
    }),
    [
      repoScriptValidationErrorCount,
      reusablePromptValidationState.totalErrorCount,
      runtimeAvailabilityValidationState.totalErrorCount,
      runtimeAvailabilityValidationState.runtimeExecutableErrors.length,
      settingsSectionErrorCountById,
    ],
  );

  const {
    isSaving,
    saveError,
    showRepoScriptValidationErrors,
    clearSaveError,
    markRepoScriptSaveAttempt,
    submit,
  } = useSettingsModalSaveOrchestration({
    open,
    loadedSnapshot,
    snapshotDraft,
    dirtySections,
    validation: {
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
      repoScripts: {
        hasErrors: hasRepoScriptValidationErrors,
        errorCount: repoScriptValidationErrorCount,
        invalidRepoPaths: invalidRepoPathsWithDevServerErrors,
        selectedWorkspaceId,
      },
    },
    onRuntimeAvailabilityError,
    saveGlobalGitConfig,
    saveSettingsSnapshot,
    loadSettingsSnapshot,
    isAgentModelFavoritesMutationPending,
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
      updateGlobalKanbanSettings: applyGlobalKanbanSettingsUpdate,
      updateGlobalAutopilotSettings: applyGlobalAutopilotSettingsUpdate,
      updateGlobalPromptOverrides: applyGlobalPromptOverridesUpdate,
      updateRepoPromptOverrides: applyRepoPromptOverridesUpdate,
      updateSelectedRepoAgentDefault: applySelectedRepoAgentDefaultUpdate,
      clearSelectedRepoAgentDefault: applyClearSelectedRepoAgentDefault,
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
      applyGlobalKanbanSettingsUpdate,
      applyGlobalAutopilotSettingsUpdate,
      applyGlobalPromptOverridesUpdate,
      applyRepoPromptOverridesUpdate,
      applySelectedRepoAgentDefaultUpdate,
      applyClearSelectedRepoAgentDefault,
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
    updateGlobalKanbanSettings,
    updateGlobalAutopilotSettings,
    updateGlobalPromptOverrides,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
  } = useSettingsModalDirtyDraftActions({
    clearSaveError,
    markDirty,
    draftActions,
  });
  const { checkAgain: checkRuntimeExecutables } = runtimeExecutableSetup;
  const checkRuntimeExecutablesAgain = useCallback(
    () => checkRuntimeExecutables(updateAgentRuntimes),
    [checkRuntimeExecutables, updateAgentRuntimes],
  );

  const { detectSelectedRepoGithubRepository } = useSettingsModalRepositoryActions({
    selectedRepoPath: selectedWorkspaceRepoPath,
    detectGithubRepository,
    updateSelectedRepoConfig,
  });

  if (!open && settingsError !== null) {
    clearSettingsError();
  }

  return {
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
    runtimeCheck,
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
    requiresCodexDangerAcknowledgement,
    isCodexDangerAcknowledged,
    selectedRepoRuntimeAvailabilityErrors,
    selectedRepoRuntimeAvailabilityErrorCount,
    hasRepoScriptValidationErrors,
    repoScriptValidationErrorCountByWorkspaceId,
    repoScriptValidationErrorCount,
    showRepoScriptValidationErrors,
    selectedRepoDevServerValidationErrors,
    setSelectedWorkspaceId,
    markRepoScriptSaveAttempt,
    retrySelectedRepoBranchesLoad,
    retryRuntimeDefinitions: refreshRuntimeDefinitions,
    checkRuntimeExecutablesAgain,
    detectSelectedRepoGithubRepository,
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
    updateGlobalPromptOverrides,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
    submit,
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
  const selectedRepoRuntimeAvailabilityErrors = selectedWorkspaceId
    ? (validation.errorsByWorkspaceId[selectedWorkspaceId] ?? [])
    : [];

  return {
    runtimeAvailabilityValidationState: validation,
    hasRuntimeAvailabilityErrors: validation.totalErrorCount > 0,
    invalidRuntimeKind,
    selectedRepoRuntimeAvailabilityErrors,
  };
};
