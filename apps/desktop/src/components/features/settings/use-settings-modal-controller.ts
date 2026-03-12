import type {
  AgentPromptTemplateId,
  GitBranch,
  GitProviderRepository,
  RepoConfig,
  RepoPromptOverrides,
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
  SettingsSnapshot,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { pickRepositoryDirectory } from "@/lib/repo-directory";
import { REPO_SETTINGS_UPDATED_EVENT } from "@/pages/agents/use-agent-studio-repo-settings";
import { useChecksState, useWorkspaceState } from "@/state";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
import type { PromptRoleTabId, SettingsSectionId } from "./settings-modal-constants";
import type { PromptValidationState } from "./settings-modal-controller.types";
import {
  normalizeGlobalGitConfigForSave,
  normalizeSnapshotForSave,
} from "./settings-modal-normalization";
import { useSettingsModalBranchesState } from "./use-settings-modal-branches-state";
import { useSettingsModalCatalogState } from "./use-settings-modal-catalog-state";
import { useSettingsModalDraftActions } from "./use-settings-modal-draft-actions";
import { useSettingsModalPromptValidation } from "./use-settings-modal-prompt-validation";
import { useSettingsModalSnapshotState } from "./use-settings-modal-snapshot-state";

type DirtySections = {
  globalGit: boolean;
  globalPromptOverrides: boolean;
  repoSettings: boolean;
};

const EMPTY_DIRTY_SECTIONS: DirtySections = {
  globalGit: false,
  globalPromptOverrides: false,
  repoSettings: false,
};

export type SettingsModalController = {
  isLoadingSettings: boolean;
  isLoadingRuntimeDefinitions: boolean;
  isLoadingCatalog: boolean;
  isSaving: boolean;
  isPickingWorktreeBasePath: boolean;
  settingsError: string | null;
  runtimeDefinitionsError: string | null;
  saveError: string | null;
  snapshotDraft: SettingsSnapshot | null;
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeCheck: RuntimeCheck | null;
  getCatalogForRuntime: (runtimeKind: RuntimeKind) => AgentModelCatalog | null;
  getCatalogErrorForRuntime: (runtimeKind: RuntimeKind) => string | null;
  isCatalogLoadingForRuntime: (runtimeKind: RuntimeKind) => boolean;
  repoPaths: string[];
  selectedRepoPath: string | null;
  selectedRepoConfig: RepoConfig | null;
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
  setSelectedRepoPath: (next: string) => void;
  retrySelectedRepoBranchesLoad: () => void;
  detectSelectedRepoGithubRepository: () => Promise<GitProviderRepository | null>;
  updateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
  updateGlobalGitConfig: (
    updater: (current: SettingsSnapshot["git"]) => SettingsSnapshot["git"],
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
  pickWorktreeBasePath: () => Promise<void>;
  submit: () => Promise<boolean>;
};

export const useSettingsModalController = (open: boolean): SettingsModalController => {
  const {
    activeRepo,
    loadSettingsSnapshot,
    detectGithubRepository,
    saveGlobalGitConfig,
    saveSettingsSnapshot,
  } = useWorkspaceState();
  const { runtimeCheck } = useChecksState();
  const { runtimeDefinitions, isLoadingRuntimeDefinitions, runtimeDefinitionsError } =
    useRuntimeDefinitionsContext();

  const [isSaving, setIsSaving] = useState(false);
  const [isPickingWorktreeBasePath, setIsPickingWorktreeBasePath] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirtySections, setDirtySections] = useState<DirtySections>(EMPTY_DIRTY_SECTIONS);

  const {
    loadedSnapshot,
    snapshotDraft,
    setSnapshotDraft,
    selectedRepoPath,
    setSelectedRepoPath,
    repoPaths,
    selectedRepoConfig,
    isLoadingSettings,
    settingsError,
    clearSettingsError,
  } = useSettingsModalSnapshotState({
    open,
    activeRepo,
    loadSettingsSnapshot,
  });

  const {
    selectedRepoBranches,
    isLoadingSelectedRepoBranches,
    selectedRepoBranchesError,
    retrySelectedRepoBranchesLoad,
  } = useSettingsModalBranchesState({
    open,
    selectedRepoPath,
  });

  const {
    getCatalogForRuntime,
    getCatalogErrorForRuntime,
    isCatalogLoadingForRuntime,
    isLoadingCatalog,
  } = useSettingsModalCatalogState({
    open,
    selectedRepoPath,
    runtimeDefinitions,
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
    selectedRepoPath,
  });

  const {
    updateSelectedRepoConfig: applySelectedRepoConfigUpdate,
    updateGlobalGitConfig: applyGlobalGitConfigUpdate,
    updateGlobalPromptOverrides: applyGlobalPromptOverridesUpdate,
    updateRepoPromptOverrides: applyRepoPromptOverridesUpdate,
    updateSelectedRepoAgentDefault: applySelectedRepoAgentDefaultUpdate,
    clearSelectedRepoAgentDefault: applyClearSelectedRepoAgentDefault,
  } = useSettingsModalDraftActions({
    selectedRepoPath,
    setSnapshotDraft,
  });

  const markDirty = useCallback((section: keyof DirtySections): void => {
    setDirtySections((current) => {
      if (current[section]) {
        return current;
      }
      return {
        ...current,
        [section]: true,
      };
    });
  }, []);

  const updateSelectedRepoConfig = useCallback(
    (updater: (current: RepoConfig) => RepoConfig): void => {
      markDirty("repoSettings");
      applySelectedRepoConfigUpdate(updater);
    },
    [applySelectedRepoConfigUpdate, markDirty],
  );

  const updateGlobalGitConfig = useCallback(
    (updater: (current: SettingsSnapshot["git"]) => SettingsSnapshot["git"]): void => {
      markDirty("globalGit");
      applyGlobalGitConfigUpdate(updater);
    },
    [applyGlobalGitConfigUpdate, markDirty],
  );

  const updateGlobalPromptOverrides = useCallback(
    (updater: (current: RepoPromptOverrides) => RepoPromptOverrides): void => {
      markDirty("globalPromptOverrides");
      applyGlobalPromptOverridesUpdate(updater);
    },
    [applyGlobalPromptOverridesUpdate, markDirty],
  );

  const updateRepoPromptOverrides = useCallback(
    (updater: (current: RepoPromptOverrides) => RepoPromptOverrides): void => {
      markDirty("repoSettings");
      applyRepoPromptOverridesUpdate(updater);
    },
    [applyRepoPromptOverridesUpdate, markDirty],
  );

  const updateSelectedRepoAgentDefault = useCallback(
    (
      role: "spec" | "planner" | "build" | "qa",
      field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
      value: string,
    ): void => {
      markDirty("repoSettings");
      applySelectedRepoAgentDefaultUpdate(role, field, value);
    },
    [applySelectedRepoAgentDefaultUpdate, markDirty],
  );

  const clearSelectedRepoAgentDefault = useCallback(
    (role: "spec" | "planner" | "build" | "qa"): void => {
      markDirty("repoSettings");
      applyClearSelectedRepoAgentDefault(role);
    },
    [applyClearSelectedRepoAgentDefault, markDirty],
  );

  useEffect(() => {
    if (!open) {
      setDirtySections(EMPTY_DIRTY_SECTIONS);
      setSaveError(null);
      clearSettingsError();
    }
  }, [clearSettingsError, open]);

  useEffect(() => {
    if (!open || !loadedSnapshot) {
      return;
    }
    setDirtySections(EMPTY_DIRTY_SECTIONS);
  }, [loadedSnapshot, open]);

  const pickWorktreeBasePath = useCallback(async (): Promise<void> => {
    setIsPickingWorktreeBasePath(true);

    try {
      const selectedDirectory = await pickRepositoryDirectory();
      if (!selectedDirectory) {
        return;
      }

      updateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        worktreeBasePath: selectedDirectory,
      }));
    } catch (error: unknown) {
      toast.error("Failed to pick worktree base path", {
        description: errorMessage(error),
      });
    } finally {
      setIsPickingWorktreeBasePath(false);
    }
  }, [updateSelectedRepoConfig]);

  const detectSelectedRepoGithubRepository = useCallback(async () => {
    if (!selectedRepoPath) {
      return null;
    }

    const detected = await detectGithubRepository(selectedRepoPath);
    if (!detected) {
      return null;
    }

    updateSelectedRepoConfig((repoConfig) => {
      const currentGithub = repoConfig.git.providers.github ?? {
        enabled: false,
        autoDetected: false,
      };
      const hasExistingRepository = Boolean(currentGithub.repository);

      return {
        ...repoConfig,
        git: {
          ...repoConfig.git,
          providers: {
            ...repoConfig.git.providers,
            github: {
              enabled: hasExistingRepository ? currentGithub.enabled : true,
              autoDetected: true,
              repository: detected,
            },
          },
        },
      };
    });

    return detected;
  }, [detectGithubRepository, selectedRepoPath, updateSelectedRepoConfig]);

  const submit = useCallback(async (): Promise<boolean> => {
    if (!snapshotDraft) {
      return false;
    }

    if (hasPromptValidationErrors) {
      const suffix = promptValidationState.totalErrorCount > 1 ? "s" : "";
      const reason = `Fix ${promptValidationState.totalErrorCount} prompt placeholder error${suffix} before saving.`;
      setSaveError(reason);
      toast.error("Cannot save settings", {
        description: reason,
      });
      return false;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      if (
        !dirtySections.globalGit &&
        !dirtySections.globalPromptOverrides &&
        !dirtySections.repoSettings
      ) {
        return true;
      }

      const shouldUseGlobalGitSave =
        dirtySections.globalGit &&
        !dirtySections.globalPromptOverrides &&
        !dirtySections.repoSettings;

      if (shouldUseGlobalGitSave) {
        const normalizedGit = normalizeGlobalGitConfigForSave(snapshotDraft.git);
        const loadedGit = loadedSnapshot
          ? normalizeGlobalGitConfigForSave(loadedSnapshot.git)
          : null;
        if (loadedGit && loadedGit.defaultMergeMethod === normalizedGit.defaultMergeMethod) {
          return true;
        }

        await saveGlobalGitConfig(normalizedGit);
      } else {
        const normalizedSnapshot = normalizeSnapshotForSave(snapshotDraft);
        await saveSettingsSnapshot(normalizedSnapshot);
      }

      if (typeof window !== "undefined" && activeRepo && !shouldUseGlobalGitSave) {
        window.dispatchEvent(
          new CustomEvent(REPO_SETTINGS_UPDATED_EVENT, {
            detail: { repoPath: activeRepo },
          }),
        );
      }

      return true;
    } catch (error: unknown) {
      const reason = errorMessage(error);
      setSaveError(reason);
      toast.error("Failed to save workspace settings", {
        description: reason,
      });
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [
    activeRepo,
    dirtySections.globalGit,
    dirtySections.globalPromptOverrides,
    dirtySections.repoSettings,
    hasPromptValidationErrors,
    loadedSnapshot,
    promptValidationState.totalErrorCount,
    saveGlobalGitConfig,
    saveSettingsSnapshot,
    snapshotDraft,
  ]);

  return {
    isLoadingSettings,
    isLoadingRuntimeDefinitions,
    isLoadingCatalog,
    isSaving,
    isPickingWorktreeBasePath,
    settingsError,
    runtimeDefinitionsError,
    saveError,
    snapshotDraft,
    runtimeDefinitions,
    runtimeCheck,
    getCatalogForRuntime,
    getCatalogErrorForRuntime,
    isCatalogLoadingForRuntime,
    repoPaths,
    selectedRepoPath,
    selectedRepoConfig,
    selectedRepoBranches,
    isLoadingSelectedRepoBranches,
    selectedRepoBranchesError,
    promptValidationState,
    hasPromptValidationErrors,
    selectedRepoPromptValidationErrors,
    selectedRepoPromptValidationErrorCount,
    globalPromptRoleTabErrorCounts,
    selectedRepoPromptRoleTabErrorCounts,
    settingsSectionErrorCountById,
    setSelectedRepoPath,
    retrySelectedRepoBranchesLoad,
    detectSelectedRepoGithubRepository,
    updateSelectedRepoConfig,
    updateGlobalGitConfig,
    updateGlobalPromptOverrides,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
    pickWorktreeBasePath,
    submit,
  };
};
