import type { SettingsSnapshot } from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { PromptValidationState } from "./settings-modal-controller.types";
import {
  buildPromptValidationSaveError,
  buildRepoScriptValidationSaveError,
  buildReusablePromptValidationSaveError,
  hasAnyDirtySections,
  hasSameSaveReadyGlobalGitConfig,
  isGlobalGitOnlySave,
} from "./settings-modal-save-policy";
import { prepareGlobalGitSettingsForSave } from "./settings-save/global-git-settings";
import { prepareSettingsSnapshotForSave } from "./settings-save/settings-snapshot";
import type { DirtySections } from "./use-settings-modal-dirty-state";

type UseSettingsModalSaveOrchestrationArgs = {
  open: boolean;
  loadedSnapshot: SettingsSnapshot | null;
  snapshotDraft: SettingsSnapshot | null;
  dirtySections: DirtySections;
  hasPromptValidationErrors: boolean;
  promptValidationState: PromptValidationState;
  hasReusablePromptValidationErrors: boolean;
  reusablePromptValidationErrorCount: number;
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
  hasReusablePromptValidationErrors,
  reusablePromptValidationErrorCount,
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
  const saveInFlightRef = useRef(false);

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
    if (saveInFlightRef.current || !snapshotDraft) {
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

    if (hasReusablePromptValidationErrors) {
      const reason = buildReusablePromptValidationSaveError(reusablePromptValidationErrorCount);
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

    setSaveError(null);

    if (!hasAnyDirtySections(dirtySections)) {
      return true;
    }

    const saveReadyGit = isGlobalGitOnlySave(dirtySections)
      ? prepareGlobalGitSettingsForSave(snapshotDraft.git)
      : null;
    if (saveReadyGit && hasSameSaveReadyGlobalGitConfig(loadedSnapshot, saveReadyGit)) {
      return true;
    }

    saveInFlightRef.current = true;
    setIsSaving(true);

    try {
      if (saveReadyGit) {
        await saveGlobalGitConfig(saveReadyGit);
      } else {
        const saveReadySnapshot = prepareSettingsSnapshotForSave(snapshotDraft);
        await saveSettingsSnapshot(saveReadySnapshot);
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
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  }, [
    dirtySections,
    reusablePromptValidationErrorCount,
    hasPromptValidationErrors,
    hasReusablePromptValidationErrors,
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
