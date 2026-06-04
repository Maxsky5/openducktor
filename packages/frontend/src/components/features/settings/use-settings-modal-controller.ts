import type {
  AgentPromptTemplateId,
  AgentRuntimes,
  GitBranch,
  GitProviderRepository,
  RepoConfig,
  RepoPromptOverrides,
  ReusablePrompt,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
  SettingsSnapshot,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useMemo } from "react";
import { getNeededCatalogRuntimeKinds } from "@/components/features/settings";
import { getAvailableRuntimeDefinitions } from "@/lib/agent-runtime";
import {
  ChecksStateContext,
  useRequiredContext,
  useRuntimeAvailabilityContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import type { PromptRoleTabId, SettingsSectionId } from "./settings-modal-constants";
import type { PromptValidationState } from "./settings-modal-controller.types";
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

export type SettingsModalController = {
  isLoadingSettings: boolean;
  isLoadingRuntimeDefinitions: boolean;
  isLoadingCatalog: boolean;
  isSaving: boolean;
  settingsError: string | null;
  runtimeDefinitionsError: string | null;
  saveError: string | null;
  snapshotDraft: SettingsSnapshot | null;
  runtimeDefinitions: RuntimeDescriptor[];
  availableRuntimeDefinitions: RuntimeDescriptor[];
  runtimeCheck: RuntimeCheck | null;
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  getCatalogErrorForRuntime: (runtimeKind: RuntimeKind) => string | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  workspaces: WorkspaceRecord[];
  workspaceIds: string[];
  selectedWorkspaceId: string | null;
  selectedRepoConfig: RepoConfig | null;
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
  selectedRepoRuntimeAvailabilityErrors: string[];
  selectedRepoRuntimeAvailabilityErrorCount: number;
  hasRepoScriptValidationErrors: boolean;
  repoScriptValidationErrorCount: number;
  showRepoScriptValidationErrors: boolean;
  selectedRepoDevServerValidationErrors: Record<string, { name?: string; command?: string }>;
  setSelectedWorkspaceId: (next: string) => void;
  markRepoScriptSaveAttempt: () => void;
  retrySelectedRepoBranchesLoad: () => void;
  detectSelectedRepoGithubRepository: () => Promise<GitProviderRepository | null>;
  updateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
  updateGlobalGitConfig: (
    updater: (current: SettingsSnapshot["git"]) => SettingsSnapshot["git"],
  ) => void;
  updateGlobalChatSettings: (
    updater: (current: SettingsSnapshot["chat"]) => SettingsSnapshot["chat"],
  ) => void;
  updateGlobalGeneralSettings: (
    updater: (current: SettingsSnapshot["general"]) => SettingsSnapshot["general"],
  ) => void;
  updateAgentRuntimes: (updater: (current: AgentRuntimes) => AgentRuntimes) => void;
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
};

export const useSettingsModalController = ({
  open,
  shouldLoadCatalog,
}: UseSettingsModalControllerArgs): SettingsModalController => {
  const workspaceState = useRequiredContext(WorkspaceStateContext, "useSettingsModalController");
  const checksState = useRequiredContext(ChecksStateContext, "useSettingsModalController");
  const {
    activeWorkspace,
    workspaces,
    loadSettingsSnapshot,
    detectGithubRepository,
    saveGlobalGitConfig,
    saveSettingsSnapshot,
  } = workspaceState;
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { runtimeCheck } = checksState;
  const {
    allRuntimeDefinitions: runtimeDefinitions,
    isLoadingRuntimeDefinitions,
    runtimeDefinitionsError,
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
  } = useSettingsModalSnapshotState({
    open,
    workspaceRepoPath: workspaceRepoPath,
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
  const catalogRuntimeKinds = useMemo(
    () => getNeededCatalogRuntimeKinds(selectedRepoConfig, availableRuntimeDefinitions),
    [availableRuntimeDefinitions, selectedRepoConfig],
  );

  const {
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
  const runtimeAvailabilityValidationState = useSettingsModalRuntimeValidation({
    runtimeDefinitions,
    snapshotDraft,
  });
  const hasRuntimeAvailabilityErrors = runtimeAvailabilityValidationState.totalErrorCount > 0;
  const selectedRepoRuntimeAvailabilityErrors = selectedWorkspaceId
    ? (runtimeAvailabilityValidationState.errorsByWorkspaceId[selectedWorkspaceId] ?? [])
    : [];
  const selectedRepoRuntimeAvailabilityErrorCount = selectedRepoRuntimeAvailabilityErrors.length;
  const settingsSectionErrorCountByIdWithReusablePrompts = useMemo(
    () => ({
      ...settingsSectionErrorCountById,
      repositories:
        settingsSectionErrorCountById.repositories +
        runtimeAvailabilityValidationState.totalErrorCount,
      "reusable-prompts": reusablePromptValidationState.totalErrorCount,
    }),
    [
      reusablePromptValidationState.totalErrorCount,
      runtimeAvailabilityValidationState.totalErrorCount,
      settingsSectionErrorCountById,
    ],
  );

  const {
    updateSelectedRepoConfig: applySelectedRepoConfigUpdate,
    updateGlobalGitConfig: applyGlobalGitConfigUpdate,
    updateGlobalChatSettings: applyGlobalChatSettingsUpdate,
    updateGlobalGeneralSettings: applyGlobalGeneralSettingsUpdate,
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
    repoScriptValidationErrorCount,
    hasRepoScriptValidationErrors,
  } = useSettingsModalRepoScriptValidation({
    snapshotDraft,
    selectedRepoConfig,
  });

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
    hasPromptValidationErrors,
    promptValidationState,
    hasReusablePromptValidationErrors: hasReusablePromptValidationErrors,
    reusablePromptValidationErrorCount: reusablePromptValidationState.totalErrorCount,
    hasRuntimeAvailabilityErrors,
    runtimeAvailabilityErrorCount: runtimeAvailabilityValidationState.totalErrorCount,
    hasRepoScriptValidationErrors,
    repoScriptValidationErrorCount,
    invalidRepoPathsWithDevServerErrors,
    selectedWorkspaceId,
    saveGlobalGitConfig,
    saveSettingsSnapshot,
  });
  const draftActions = useMemo(
    () => ({
      updateSelectedRepoConfig: applySelectedRepoConfigUpdate,
      updateGlobalGitConfig: applyGlobalGitConfigUpdate,
      updateGlobalChatSettings: applyGlobalChatSettingsUpdate,
      updateGlobalGeneralSettings: applyGlobalGeneralSettingsUpdate,
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
      applyGlobalGeneralSettingsUpdate,
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
    updateGlobalGeneralSettings,
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
    isLoadingCatalog,
    isSaving,
    settingsError,
    runtimeDefinitionsError,
    saveError,
    snapshotDraft,
    runtimeDefinitions,
    availableRuntimeDefinitions,
    runtimeCheck,
    getCatalogForRuntime,
    getCatalogErrorForRuntime,
    isCatalogLoadingForRuntime,
    workspaces,
    workspaceIds,
    selectedWorkspaceId,
    selectedRepoConfig,
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
    settingsSectionErrorCountById: settingsSectionErrorCountByIdWithReusablePrompts,
    reusablePromptValidationState,
    hasReusablePromptValidationErrors,
    runtimeAvailabilityValidationState,
    hasRuntimeAvailabilityErrors,
    selectedRepoRuntimeAvailabilityErrors,
    selectedRepoRuntimeAvailabilityErrorCount,
    hasRepoScriptValidationErrors,
    repoScriptValidationErrorCount,
    showRepoScriptValidationErrors,
    selectedRepoDevServerValidationErrors,
    setSelectedWorkspaceId,
    markRepoScriptSaveAttempt,
    retrySelectedRepoBranchesLoad,
    detectSelectedRepoGithubRepository,
    updateSelectedRepoConfig,
    updateGlobalGitConfig,
    updateGlobalChatSettings,
    updateGlobalGeneralSettings,
    updateAgentRuntimes,
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
