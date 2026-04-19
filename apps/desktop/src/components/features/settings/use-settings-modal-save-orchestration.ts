import type { SettingsSnapshot } from "@openducktor/contracts";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { PromptValidationState } from "./settings-modal-controller.types";
import {
  normalizeGlobalGitConfigForSave,
  normalizeSnapshotForSave,
} from "./settings-modal-normalization";
import {
  buildPromptValidationSaveError,
  buildRepoScriptValidationSaveError,
  hasAnyDirtySections,
  hasSameNormalizedGlobalGitConfig,
  isGlobalGitOnlySave,
} from "./settings-modal-save-policy";
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
      const reason = buildPromptValidationSaveError(promptValidationState.totalErrorCount);
      setSaveError(reason);
      toast.error("Cannot save settings", {
        description: reason,
      });
      return false;
    }

    if (hasRepoScriptValidationErrors) {
      setHasAttemptedRepoScriptSubmit(true);
      const reason = buildRepoScriptValidationSaveError({
        invalidRepoPathsWithDevServerErrors,
        repoScriptValidationErrorCount,
        selectedWorkspaceId,
      });
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
        if (hasSameNormalizedGlobalGitConfig(loadedSnapshot, normalizedGit)) {
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
