import type {
  AgentPromptTemplateId,
  GitBranch,
  RepoConfig,
  RepoPromptOverrides,
  SettingsSnapshot,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { ComboboxOption } from "@/components/ui/combobox";
import { errorMessage } from "@/lib/errors";
import { pickRepositoryDirectory } from "@/lib/repo-directory";
import { REPO_SETTINGS_UPDATED_EVENT } from "@/pages/agents/use-agent-studio-repo-settings";
import { useWorkspaceState } from "@/state";
import type { PromptRoleTabId, SettingsSectionId } from "./settings-modal-constants";
import type { PromptValidationState } from "./settings-modal-controller.types";
import { normalizeSnapshotForSave } from "./settings-modal-normalization";
import { useSettingsModalBranchesState } from "./use-settings-modal-branches-state";
import { useSettingsModalCatalogState } from "./use-settings-modal-catalog-state";
import { useSettingsModalDraftActions } from "./use-settings-modal-draft-actions";
import { useSettingsModalPromptValidation } from "./use-settings-modal-prompt-validation";
import { useSettingsModalSnapshotState } from "./use-settings-modal-snapshot-state";

export type SettingsModalController = {
  isLoadingSettings: boolean;
  isLoadingCatalog: boolean;
  isSaving: boolean;
  isPickingWorktreeBasePath: boolean;
  settingsError: string | null;
  catalogError: string | null;
  saveError: string | null;
  snapshotDraft: SettingsSnapshot | null;
  catalog: AgentModelCatalog | null;
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
  modelOptions: ComboboxOption[];
  agentOptions: ComboboxOption[];
  modelGroups: {
    label: string;
    options: ComboboxOption[];
  }[];
  setSelectedRepoPath: (next: string) => void;
  retrySelectedRepoBranchesLoad: () => void;
  updateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
  updateGlobalPromptOverrides: (
    updater: (current: RepoPromptOverrides) => RepoPromptOverrides,
  ) => void;
  updateRepoPromptOverrides: (
    updater: (current: RepoPromptOverrides) => RepoPromptOverrides,
  ) => void;
  updateSelectedRepoAgentDefault: (
    role: "spec" | "planner" | "build" | "qa",
    field: "providerId" | "modelId" | "variant" | "opencodeAgent",
    value: string,
  ) => void;
  clearSelectedRepoAgentDefault: (role: "spec" | "planner" | "build" | "qa") => void;
  pickWorktreeBasePath: () => Promise<void>;
  submit: () => Promise<boolean>;
};

export const useSettingsModalController = (open: boolean): SettingsModalController => {
  const { activeRepo, loadSettingsSnapshot, saveSettingsSnapshot } = useWorkspaceState();

  const [isSaving, setIsSaving] = useState(false);
  const [isPickingWorktreeBasePath, setIsPickingWorktreeBasePath] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const {
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

  const { catalog, catalogError, isLoadingCatalog, modelOptions, agentOptions, modelGroups } =
    useSettingsModalCatalogState({
      open,
      selectedRepoPath,
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
    updateSelectedRepoConfig,
    updateGlobalPromptOverrides,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
  } = useSettingsModalDraftActions({
    selectedRepoPath,
    setSnapshotDraft,
  });

  useEffect(() => {
    if (open) {
      return;
    }
    setSaveError(null);
    clearSettingsError();
  }, [clearSettingsError, open]);

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
      await saveSettingsSnapshot(normalizeSnapshotForSave(snapshotDraft));

      if (typeof window !== "undefined" && activeRepo) {
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
    hasPromptValidationErrors,
    promptValidationState.totalErrorCount,
    saveSettingsSnapshot,
    snapshotDraft,
  ]);

  return {
    isLoadingSettings,
    isLoadingCatalog,
    isSaving,
    isPickingWorktreeBasePath,
    settingsError,
    catalogError,
    saveError,
    snapshotDraft,
    catalog,
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
    modelOptions,
    agentOptions,
    modelGroups,
    setSelectedRepoPath,
    retrySelectedRepoBranchesLoad,
    updateSelectedRepoConfig,
    updateGlobalPromptOverrides,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
    pickWorktreeBasePath,
    submit,
  };
};
