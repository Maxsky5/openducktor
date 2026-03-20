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
  WorkspaceRecord,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  buildDevServerDraftValidationMap,
  countDevServerDraftValidationErrors,
} from "@/components/features/settings";
import { errorMessage } from "@/lib/errors";
import { pickRepositoryDirectory } from "@/lib/repo-directory";
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
  chat: boolean;
  globalGit: boolean;
  globalPromptOverrides: boolean;
  repoSettings: boolean;
};

const EMPTY_DIRTY_SECTIONS: DirtySections = {
  chat: false,
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
  selectedRepoWorkspace: WorkspaceRecord | null;
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
  hasRepoScriptValidationErrors: boolean;
  repoScriptValidationErrorCount: number;
  showRepoScriptValidationErrors: boolean;
  selectedRepoDevServerValidationErrors: Record<string, { name?: string; command?: string }>;
  setSelectedRepoPath: (next: string) => void;
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
    workspaces,
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
  const [hasAttemptedRepoScriptSubmit, setHasAttemptedRepoScriptSubmit] = useState(false);
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
    updateGlobalChatSettings: applyGlobalChatSettingsUpdate,
    updateGlobalPromptOverrides: applyGlobalPromptOverridesUpdate,
    updateRepoPromptOverrides: applyRepoPromptOverridesUpdate,
    updateSelectedRepoAgentDefault: applySelectedRepoAgentDefaultUpdate,
    clearSelectedRepoAgentDefault: applyClearSelectedRepoAgentDefault,
  } = useSettingsModalDraftActions({
    selectedRepoPath,
    setSnapshotDraft,
  });

  const selectedRepoWorkspace = useMemo(
    () =>
      selectedRepoPath
        ? (workspaces.find((workspace) => workspace.path === selectedRepoPath) ?? null)
        : null,
    [selectedRepoPath, workspaces],
  );
  const selectedRepoDefaultWorktreeBasePath =
    selectedRepoWorkspace?.defaultWorktreeBasePath ?? null;
  const selectedRepoEffectiveWorktreeBasePath = useMemo(() => {
    const draftWorktreeBasePath = selectedRepoConfig?.worktreeBasePath?.trim();
    if (draftWorktreeBasePath) {
      return draftWorktreeBasePath;
    }

    return selectedRepoDefaultWorktreeBasePath;
  }, [selectedRepoConfig?.worktreeBasePath, selectedRepoDefaultWorktreeBasePath]);
  const selectedRepoDevServerValidationErrors = useMemo(() => {
    if (!selectedRepoConfig) {
      return {};
    }

    return buildDevServerDraftValidationMap(selectedRepoConfig.devServers ?? []);
  }, [selectedRepoConfig]);
  const repoScriptValidationSummary = useMemo(() => {
    if (!snapshotDraft) {
      return {
        invalidRepoPathsWithDevServerErrors: [] as string[],
        repoScriptValidationErrorCount: 0,
      };
    }

    const invalidRepoPathsWithDevServerErrors: string[] = [];
    let repoScriptValidationErrorCount = 0;

    for (const [repoPath, repoConfig] of Object.entries(snapshotDraft.repos)) {
      const errorCount = countDevServerDraftValidationErrors(repoConfig.devServers ?? []);
      if (errorCount > 0) {
        invalidRepoPathsWithDevServerErrors.push(repoPath);
        repoScriptValidationErrorCount += errorCount;
      }
    }

    invalidRepoPathsWithDevServerErrors.sort();

    return {
      invalidRepoPathsWithDevServerErrors,
      repoScriptValidationErrorCount,
    };
  }, [snapshotDraft]);
  const { invalidRepoPathsWithDevServerErrors, repoScriptValidationErrorCount } =
    repoScriptValidationSummary;
  const hasRepoScriptValidationErrors = repoScriptValidationErrorCount > 0;
  const showRepoScriptValidationErrors =
    hasAttemptedRepoScriptSubmit && hasRepoScriptValidationErrors;

  const markRepoScriptSaveAttempt = useCallback((): void => {
    setHasAttemptedRepoScriptSubmit(true);
  }, []);

  const markDirty = useCallback((section: keyof DirtySections): void => {
    setSaveError(null);
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

  const updateGlobalChatSettings = useCallback(
    (updater: (current: SettingsSnapshot["chat"]) => SettingsSnapshot["chat"]): void => {
      markDirty("chat");
      applyGlobalChatSettingsUpdate(updater);
    },
    [applyGlobalChatSettingsUpdate, markDirty],
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
      setHasAttemptedRepoScriptSubmit(false);
      clearSettingsError();
    }
  }, [clearSettingsError, open]);

  useEffect(() => {
    if (!open || !loadedSnapshot) {
      return;
    }
    setDirtySections(EMPTY_DIRTY_SECTIONS);
    setHasAttemptedRepoScriptSubmit(false);
  }, [loadedSnapshot, open]);

  useEffect(() => {
    if (!hasRepoScriptValidationErrors) {
      setHasAttemptedRepoScriptSubmit(false);
    }
  }, [hasRepoScriptValidationErrors]);

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

    if (hasRepoScriptValidationErrors) {
      setHasAttemptedRepoScriptSubmit(true);
      const suffix = repoScriptValidationErrorCount > 1 ? "s" : "";
      const invalidRepoSummary = invalidRepoPathsWithDevServerErrors
        .map((repoPath) =>
          repoPath === selectedRepoPath ? "the selected repository" : `\`${repoPath}\``,
        )
        .join(", ");
      const reason = `Fix ${repoScriptValidationErrorCount} dev server field error${suffix} in ${invalidRepoSummary} before saving.`;
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
        !dirtySections.chat &&
        !dirtySections.globalGit &&
        !dirtySections.globalPromptOverrides &&
        !dirtySections.repoSettings
      ) {
        return true;
      }

      const shouldUseGlobalGitSave =
        dirtySections.globalGit &&
        !dirtySections.chat &&
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
    dirtySections.chat,
    dirtySections.globalGit,
    dirtySections.globalPromptOverrides,
    dirtySections.repoSettings,
    hasPromptValidationErrors,
    hasRepoScriptValidationErrors,
    invalidRepoPathsWithDevServerErrors,
    loadedSnapshot,
    promptValidationState.totalErrorCount,
    repoScriptValidationErrorCount,
    selectedRepoPath,
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
    selectedRepoWorkspace,
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
    settingsSectionErrorCountById,
    hasRepoScriptValidationErrors,
    repoScriptValidationErrorCount,
    showRepoScriptValidationErrors,
    selectedRepoDevServerValidationErrors,
    setSelectedRepoPath,
    markRepoScriptSaveAttempt,
    retrySelectedRepoBranchesLoad,
    detectSelectedRepoGithubRepository,
    updateSelectedRepoConfig,
    updateGlobalGitConfig,
    updateGlobalChatSettings,
    updateGlobalPromptOverrides,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
    pickWorktreeBasePath,
    submit,
  };
};
