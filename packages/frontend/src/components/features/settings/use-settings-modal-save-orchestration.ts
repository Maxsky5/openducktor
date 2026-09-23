import type {
  RuntimeKind,
  SettingsSnapshot,
  SettingsSnapshotSaveInput,
} from "@openducktor/contracts";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import {
  getSettingsSaveBlocker,
  hasAnyDirtySections,
  hasSameSaveReadyGlobalGitConfig,
  isGlobalGitOnlySave,
  type SettingsSaveValidation,
} from "./settings-modal-save-policy";
import { prepareGlobalGitSettingsForSave } from "./settings-save/global-git-settings";
import { prepareSettingsSnapshotForSave } from "./settings-save/settings-snapshot";
import type { DirtySections } from "./use-settings-modal-dirty-state";

type UseSettingsModalSaveOrchestrationArgs = {
  open: boolean;
  loadedSnapshot: SettingsSnapshot | null;
  snapshotDraft: SettingsSnapshot | null;
  dirtySections: DirtySections;
  validation: SettingsSaveValidation;
  onRuntimeAvailabilityError: (runtimeKind: RuntimeKind) => void;
  saveGlobalGitConfig: (config: SettingsSnapshot["git"]) => Promise<void>;
  saveSettingsSnapshot: (snapshot: SettingsSnapshotSaveInput) => Promise<void>;
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>;
  isAgentModelFavoritesMutationPending: boolean;
  isKanbanTaskCardViewMutationPending: boolean;
  wasKanbanTaskCardViewEdited: boolean;
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
  validation,
  onRuntimeAvailabilityError,
  saveGlobalGitConfig,
  saveSettingsSnapshot,
  loadSettingsSnapshot,
  isAgentModelFavoritesMutationPending,
  isKanbanTaskCardViewMutationPending,
  wasKanbanTaskCardViewEdited,
}: UseSettingsModalSaveOrchestrationArgs): SettingsModalSaveOrchestration => {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasAttemptedRepoScriptSubmit, setHasAttemptedRepoScriptSubmit] = useState(false);
  const [resetInputs, setResetInputs] = useState({
    hasRepoScriptValidationErrors: validation.repoScripts.hasErrors,
    loadedSnapshot,
    open,
  });
  const saveInFlightRef = useRef(false);

  const clearSaveError = useCallback((): void => {
    setSaveError(null);
  }, []);

  const markRepoScriptSaveAttempt = useCallback((): void => {
    setHasAttemptedRepoScriptSubmit(true);
  }, []);

  if (
    resetInputs.open !== open ||
    resetInputs.loadedSnapshot !== loadedSnapshot ||
    resetInputs.hasRepoScriptValidationErrors !== validation.repoScripts.hasErrors
  ) {
    setResetInputs({
      hasRepoScriptValidationErrors: validation.repoScripts.hasErrors,
      loadedSnapshot,
      open,
    });

    if (!open) {
      setSaveError(null);
      setHasAttemptedRepoScriptSubmit(false);
    }

    if (!validation.repoScripts.hasErrors) {
      setHasAttemptedRepoScriptSubmit(false);
    }

    if (open && loadedSnapshot) {
      setHasAttemptedRepoScriptSubmit(false);
    }
  }

  const submit = useCallback(async (): Promise<boolean> => {
    if (saveInFlightRef.current || !snapshotDraft) {
      return false;
    }

    const blocker = getSettingsSaveBlocker(validation);
    if (blocker) {
      const { reason } = blocker;
      setSaveError(reason);
      if (blocker.runtimeKind) {
        onRuntimeAvailabilityError(blocker.runtimeKind);
      }
      if (blocker.showRepoScriptErrors) {
        setHasAttemptedRepoScriptSubmit(true);
      }
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

    if (!saveReadyGit && isAgentModelFavoritesMutationPending) {
      const reason = "Wait for the model favorites update to finish before saving settings.";
      setSaveError(reason);
      toast.error("Cannot save settings", {
        description: reason,
      });
      return false;
    }

    if (!saveReadyGit && isKanbanTaskCardViewMutationPending) {
      const reason = "Wait for the task card view update to finish before saving settings.";
      setSaveError(reason);
      toast.error("Cannot save settings", {
        description: reason,
      });
      return false;
    }

    saveInFlightRef.current = true;
    setIsSaving(true);

    try {
      if (saveReadyGit) {
        await saveGlobalGitConfig(saveReadyGit);
      } else {
        const latestSnapshot = await loadSettingsSnapshot();
        const taskCardView = wasKanbanTaskCardViewEdited
          ? snapshotDraft.kanban.taskCardView
          : latestSnapshot.kanban.taskCardView;
        const saveReadySnapshot = prepareSettingsSnapshotForSave(
          {
            ...snapshotDraft,
            agentModelFavorites: latestSnapshot.agentModelFavorites,
            kanban: { ...snapshotDraft.kanban, taskCardView },
          },
          { saveCustomAgentRoles: dirtySections.customAgentRoles },
        );
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
    isAgentModelFavoritesMutationPending,
    isKanbanTaskCardViewMutationPending,
    loadSettingsSnapshot,
    loadedSnapshot,
    onRuntimeAvailabilityError,
    saveGlobalGitConfig,
    saveSettingsSnapshot,
    snapshotDraft,
    validation,
    wasKanbanTaskCardViewEdited,
  ]);

  return {
    isSaving,
    saveError,
    showRepoScriptValidationErrors:
      hasAttemptedRepoScriptSubmit && validation.repoScripts.hasErrors,
    clearSaveError,
    markRepoScriptSaveAttempt,
    submit,
  };
};
