import type { SettingsSnapshot } from "@openducktor/contracts";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { PromptValidationState } from "./settings-modal-controller.types";
import {
  normalizeGlobalGitConfigForSave,
  normalizeSnapshotForSave,
} from "./settings-modal-normalization";
import type { DirtySections } from "./use-settings-modal-dirty-state";

type UseSettingsModalSaveOrchestrationArgs = {
  open: boolean;
  loadedSnapshot: SettingsSnapshot | null;
  snapshotDraft: SettingsSnapshot | null;
  dirtySections: DirtySections;
  hasPromptValidationErrors: boolean;
  promptValidationState: PromptValidationState;
  hasRepoScriptValidationErrors: boolean;
  repoScriptValidationErrorCount: number;
  invalidRepoPathsWithDevServerErrors: string[];
  selectedWorkspaceId: string | null;
  saveGlobalGitConfig: (config: SettingsSnapshot["git"]) => Promise<void>;
  saveSettingsSnapshot: (snapshot: SettingsSnapshot) => Promise<void>;
};

type SettingsModalSaveOrchestration = {
  isSaving: boolean;
  saveError: string | null;
  showRepoScriptValidationErrors: boolean;
  clearSaveError: () => void;
  markRepoScriptSaveAttempt: () => void;
  submit: () => Promise<boolean>;
};

const hasAnyDirtySections = (dirtySections: DirtySections): boolean =>
  dirtySections.chat ||
  dirtySections.globalGit ||
  dirtySections.kanban ||
  dirtySections.autopilot ||
  dirtySections.globalPromptOverrides ||
  dirtySections.repoSettings;

const isGlobalGitOnlySave = (dirtySections: DirtySections): boolean =>
  dirtySections.globalGit &&
  !dirtySections.chat &&
  !dirtySections.kanban &&
  !dirtySections.autopilot &&
  !dirtySections.globalPromptOverrides &&
  !dirtySections.repoSettings;

export const useSettingsModalSaveOrchestration = ({
  open,
  loadedSnapshot,
  snapshotDraft,
  dirtySections,
  hasPromptValidationErrors,
  promptValidationState,
  hasRepoScriptValidationErrors,
  repoScriptValidationErrorCount,
  invalidRepoPathsWithDevServerErrors,
  selectedWorkspaceId,
  saveGlobalGitConfig,
  saveSettingsSnapshot,
}: UseSettingsModalSaveOrchestrationArgs): SettingsModalSaveOrchestration => {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasAttemptedRepoScriptSubmit, setHasAttemptedRepoScriptSubmit] = useState(false);

  const clearSaveError = useCallback((): void => {
    setSaveError(null);
  }, []);

  const markRepoScriptSaveAttempt = useCallback((): void => {
    setHasAttemptedRepoScriptSubmit(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setSaveError(null);
      setHasAttemptedRepoScriptSubmit(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !loadedSnapshot) {
      return;
    }

    setHasAttemptedRepoScriptSubmit(false);
  }, [loadedSnapshot, open]);

  useEffect(() => {
    if (!hasRepoScriptValidationErrors) {
      setHasAttemptedRepoScriptSubmit(false);
    }
  }, [hasRepoScriptValidationErrors]);

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
        .map((workspaceId) =>
          workspaceId === selectedWorkspaceId ? "the selected repository" : `\`${workspaceId}\``,
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
      if (!hasAnyDirtySections(dirtySections)) {
        return true;
      }

      if (isGlobalGitOnlySave(dirtySections)) {
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
    dirtySections,
    hasPromptValidationErrors,
    hasRepoScriptValidationErrors,
    invalidRepoPathsWithDevServerErrors,
    loadedSnapshot,
    promptValidationState.totalErrorCount,
    repoScriptValidationErrorCount,
    saveGlobalGitConfig,
    saveSettingsSnapshot,
    selectedWorkspaceId,
    snapshotDraft,
  ]);

  return {
    isSaving,
    saveError,
    showRepoScriptValidationErrors: hasAttemptedRepoScriptSubmit && hasRepoScriptValidationErrors,
    clearSaveError,
    markRepoScriptSaveAttempt,
    submit,
  };
};
