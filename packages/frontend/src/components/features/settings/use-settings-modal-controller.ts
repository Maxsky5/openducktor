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
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getNeededCatalogRuntimeKinds } from "@/components/features/settings";
import { getAvailableRuntimeDefinitions } from "@/lib/agent-runtime";
import { errorMessage } from "@/lib/errors";
import {
  ChecksStateContext,
  useRequiredContext,
  useRuntimeAvailabilityContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import { runtimeDiscoveryQueryOptions } from "@/state/queries/runtime";
import { useRuntimeExecutableValidation } from "@/state/queries/use-runtime-executable-validation";
import { replaceRuntimeExecutablePaths } from "./runtime-executable-draft";
import { invalidEnabledRuntime } from "./runtime-executable-validation";
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
  const queryClient = useQueryClient();
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
  const workspaceSelectionKind = workspaceSelectionPolicy?.kind ?? "preferred";
  const workspaceSelectionRepoPath =
    workspaceSelectionPolicy === undefined ? workspaceRepoPath : workspaceSelectionPolicy.repoPath;
  const resolvedWorkspaceSelectionPolicy = useMemo<SettingsWorkspaceSelectionPolicy>(
    () => ({
      kind: workspaceSelectionKind,
      repoPath: workspaceSelectionRepoPath,
    }),
    [workspaceSelectionKind, workspaceSelectionRepoPath],
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
    workspaceSelectionPolicy: resolvedWorkspaceSelectionPolicy,
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
  const runtimeExecutableValidation = useRuntimeExecutableValidation(
    snapshotDraft?.agentRuntimes ?? null,
    open,
  );
  const runtimeDiscoveryInFlight = useRef(false);
  const runtimeDiscoveryVisit = useRef(0);
  const [isCheckingRuntimeExecutables, setIsCheckingRuntimeExecutables] = useState(false);
  const [runtimeDiscoveryError, setRuntimeDiscoveryError] = useState<string | null>(null);
  useEffect(() => {
    const visit = runtimeDiscoveryVisit.current + 1;
    runtimeDiscoveryVisit.current = visit;
    if (!open) {
      runtimeDiscoveryInFlight.current = false;
      setIsCheckingRuntimeExecutables(false);
      setRuntimeDiscoveryError(null);
      void queryClient.cancelQueries({
        queryKey: runtimeDiscoveryQueryOptions().queryKey,
        exact: true,
      });
    }
    return () => {
      if (runtimeDiscoveryVisit.current === visit) {
        runtimeDiscoveryVisit.current += 1;
      }
    };
  }, [open, queryClient]);
  const isLoadingRuntimeExecutables =
    open &&
    snapshotDraft !== null &&
    (runtimeExecutableValidation.checkingRuntimeKinds.length > 0 || isCheckingRuntimeExecutables);
  const runtimeExecutableValidationError = runtimeExecutableValidation.error
    ? errorMessage(runtimeExecutableValidation.error)
    : null;
  const runtimeExecutablesError = runtimeDiscoveryError ?? runtimeExecutableValidationError;
  const runtimeRequestError = runtimeDefinitionsError ?? runtimeExecutablesError;
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
    ...(runtimeExecutableValidation.results.length > 0
      ? { runtimeExecutableResults: runtimeExecutableValidation.results }
      : {}),
  });
  const hasRuntimeAvailabilityErrors = runtimeAvailabilityValidationState.totalErrorCount > 0;
  const invalidRuntimeKind = snapshotDraft
    ? (invalidEnabledRuntime(snapshotDraft.agentRuntimes, runtimeExecutableValidation.results)
        ?.kind ?? null)
    : null;
  const codexDangerAcknowledgementKey = useMemo(
    () =>
      snapshotDraft
        ? buildNewCodexDangerousSelectionKey({
            baseline: loadedSnapshot?.agentRuntimes.codex ?? null,
            draft: snapshotDraft.agentRuntimes.codex,
          })
        : "",
    [loadedSnapshot?.agentRuntimes.codex, snapshotDraft],
  );
  const requiresCodexDangerAcknowledgement = codexDangerAcknowledgementKey !== "";
  const [acknowledgedCodexDangerKey, setAcknowledgedCodexDangerKey] = useState("");
  useEffect(() => {
    if (!open || !requiresCodexDangerAcknowledgement) {
      setAcknowledgedCodexDangerKey("");
    }
  }, [open, requiresCodexDangerAcknowledgement]);
  const isCodexDangerAcknowledged =
    requiresCodexDangerAcknowledgement &&
    acknowledgedCodexDangerKey === codexDangerAcknowledgementKey;
  const setCodexDangerAcknowledged = useCallback(
    (acknowledged: boolean) => {
      setAcknowledgedCodexDangerKey(acknowledged ? codexDangerAcknowledgementKey : "");
    },
    [codexDangerAcknowledgementKey],
  );
  const hasUnacknowledgedCodexDangerousSettings =
    requiresCodexDangerAcknowledgement && !isCodexDangerAcknowledged;
  const {
    updateSelectedRepoConfig: applySelectedRepoConfigUpdate,
    updateGlobalGitConfig: applyGlobalGitConfigUpdate,
    updateGlobalChatSettings: applyGlobalChatSettingsUpdate,
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
      repositories: settingsSectionErrorCountById.repositories + repoScriptValidationErrorCount,
      runtimes: runtimeAvailabilityValidationState.runtimeExecutableErrors.length,
      "reusable-prompts": reusablePromptValidationState.totalErrorCount,
    }),
    [
      repoScriptValidationErrorCount,
      reusablePromptValidationState.totalErrorCount,
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
    hasPromptValidationErrors,
    promptValidationState,
    hasReusablePromptValidationErrors: hasReusablePromptValidationErrors,
    reusablePromptValidationErrorCount: reusablePromptValidationState.totalErrorCount,
    hasRuntimeAvailabilityErrors,
    runtimeAvailabilityErrorCount: runtimeAvailabilityValidationState.totalErrorCount,
    invalidRuntimeKind,
    onRuntimeAvailabilityError,
    isRuntimeRequestPending: isLoadingRuntimeDefinitions || isLoadingRuntimeExecutables,
    runtimeRequestError,
    hasUnacknowledgedCodexDangerousSettings,
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
  const checkRuntimeExecutablesAgain = useCallback(async (): Promise<void> => {
    if (runtimeDiscoveryInFlight.current) {
      return;
    }

    const visit = runtimeDiscoveryVisit.current;
    runtimeDiscoveryInFlight.current = true;
    setIsCheckingRuntimeExecutables(true);
    try {
      const discovered = await queryClient.fetchQuery(runtimeDiscoveryQueryOptions());
      if (runtimeDiscoveryVisit.current !== visit) {
        return;
      }
      updateAgentRuntimes((current) => replaceRuntimeExecutablePaths(current, discovered.runtimes));
      setRuntimeDiscoveryError(null);
    } catch (error) {
      if (runtimeDiscoveryVisit.current === visit) {
        setRuntimeDiscoveryError(errorMessage(error));
      }
    } finally {
      if (runtimeDiscoveryVisit.current === visit) {
        runtimeDiscoveryInFlight.current = false;
        setIsCheckingRuntimeExecutables(false);
      }
    }
  }, [queryClient, updateAgentRuntimes]);

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
