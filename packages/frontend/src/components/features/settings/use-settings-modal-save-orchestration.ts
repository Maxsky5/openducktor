import {
  knownRuntimeKindValues,
  type RuntimeKind,
  type RuntimeLifecycleImpact,
  type SettingsSnapshot,
  type SettingsSnapshotRuntimePreview,
  type SettingsSnapshotSaveInput,
} from "@openducktor/contracts";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  hasLiveSessions,
  RUNTIME_IMPACT_CHANGED_NOTICE,
  type RuntimeImpactActionResult,
  type RuntimeImpactReviewState,
  useRuntimeImpactReview,
} from "@/components/features/runtimes/runtime-impact-review";
import { errorMessage } from "@/lib/errors";
import type { SettingsSaveOutcome } from "@/types/state-slices";
import {
  getSettingsSaveBlocker,
  hasAnyDirtySections,
  hasSameSaveReadyGlobalGitConfig,
  isGlobalGitOnlySave,
  type SettingsSaveValidation,
} from "./settings-modal-save-policy";
import { prepareGlobalGitSettingsForSave } from "./settings-save/global-git-settings";
import {
  hasRuntimeLifecycleChange,
  reportSettingsSaveFollowUps,
} from "./settings-save/runtime-settings-application";
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
  previewSettingsSnapshotRuntime: (
    snapshot: SettingsSnapshotSaveInput,
  ) => Promise<SettingsSnapshotRuntimePreview>;
  saveSettingsSnapshot: (
    snapshot: SettingsSnapshotSaveInput,
    runtimeConfirmation?: string,
  ) => Promise<SettingsSaveOutcome>;
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>;
  isAgentModelFavoritesMutationPending: boolean;
  isKanbanTaskCardViewMutationPending: boolean;
  isSidebarSessionGroupingMutationPending: boolean;
  wasKanbanTaskCardViewEdited: boolean;
};

type SettingsModalSaveOrchestration = {
  /**
   * Live sessions that a save stops. The user confirms or cancels before anything is written.
   * Live session events keep the impact current while the review is open.
   */
  runtimeReview: RuntimeImpactReviewState | null;
  confirmRuntimeReview: () => void;
  cancelRuntimeReview: () => void;
  isSaving: boolean;
  saveError: string | null;
  clearSaveError: () => void;
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
  previewSettingsSnapshotRuntime,
  saveSettingsSnapshot,
  loadSettingsSnapshot,
  isAgentModelFavoritesMutationPending,
  isKanbanTaskCardViewMutationPending,
  isSidebarSessionGroupingMutationPending,
  wasKanbanTaskCardViewEdited,
}: UseSettingsModalSaveOrchestrationArgs): SettingsModalSaveOrchestration => {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previousOpen, setPreviousOpen] = useState(open);
  const saveInFlightRef = useRef(false);
  const {
    review: runtimeReview,
    open: openRuntimeReview,
    confirm: confirmRuntimeReview,
    cancel: cancelRuntimeReview,
  } = useRuntimeImpactReview({ kinds: knownRuntimeKindValues });

  /**
   * Saves with the confirmation of `impact`. A changed impact that stops live sessions needs a
   * new review. Any other changed impact is saved at once.
   */
  const saveConfirmed = useCallback(
    async (
      snapshot: SettingsSnapshotSaveInput,
      impact: RuntimeLifecycleImpact | null,
    ): Promise<Exclude<RuntimeImpactActionResult, { type: "failed" }>> => {
      let confirmation = impact?.confirmation;
      for (;;) {
        const result = await saveSettingsSnapshot(snapshot, confirmation);
        if (result.type !== "runtime_impact_changed") {
          reportSettingsSaveFollowUps(result, (title, description) =>
            toast.warning(title, { description }),
          );
          return { type: "completed" };
        }
        if (hasLiveSessions(result.impact)) {
          return { type: "impact_changed", impact: result.impact };
        }
        confirmation = result.impact.confirmation;
      }
    },
    [saveSettingsSnapshot],
  );

  /**
   * Saves the snapshot. When the save stops live sessions, the user reviews them first.
   * A changed impact opens the review again. Cancel keeps the draft and writes nothing.
   */
  const saveWithRuntimeReview = useCallback(
    async (snapshot: SettingsSnapshotSaveInput, latest: SettingsSnapshot): Promise<boolean> => {
      const impact = hasRuntimeLifecycleChange(latest.agentRuntimes, snapshot.agentRuntimes)
        ? (await previewSettingsSnapshotRuntime(snapshot)).impact
        : null;
      let notice: string | null = null;
      if (impact === null || !hasLiveSessions(impact)) {
        const result = await saveConfirmed(snapshot, impact);
        if (result.type === "completed") return true;
        notice = RUNTIME_IMPACT_CHANGED_NOTICE;
      }
      return openRuntimeReview({
        readImpact: async () => {
          const { impact: current } = await previewSettingsSnapshotRuntime(snapshot);
          if (!current) {
            throw new Error(
              "These settings no longer change a running runtime. Cancel, then save again.",
            );
          }
          return current;
        },
        run: (reviewed) => saveConfirmed(snapshot, reviewed),
        notice,
      });
    },
    [openRuntimeReview, previewSettingsSnapshotRuntime, saveConfirmed],
  );

  const clearSaveError = useCallback((): void => {
    setSaveError(null);
  }, []);

  if (previousOpen !== open) {
    setPreviousOpen(open);

    if (!open) {
      setSaveError(null);
      cancelRuntimeReview();
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

    if (!saveReadyGit && isSidebarSessionGroupingMutationPending) {
      const reason = "Wait for the session grouping update to finish before saving settings.";
      setSaveError(reason);
      toast.error("Cannot save settings", { description: reason });
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
        const sidebarSessionGrouping =
          loadedSnapshot &&
          snapshotDraft.appearance.sidebarSessionGrouping ===
            loadedSnapshot.appearance.sidebarSessionGrouping
            ? latestSnapshot.appearance.sidebarSessionGrouping
            : snapshotDraft.appearance.sidebarSessionGrouping;
        const saveReadySnapshot = prepareSettingsSnapshotForSave(
          {
            ...snapshotDraft,
            agentModelFavorites: latestSnapshot.agentModelFavorites,
            kanban: { ...snapshotDraft.kanban, taskCardView },
            appearance: { ...snapshotDraft.appearance, sidebarSessionGrouping },
          },
          { saveCustomAgentRoles: dirtySections.customAgentRoles },
        );
        return await saveWithRuntimeReview(saveReadySnapshot, latestSnapshot);
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
    isSidebarSessionGroupingMutationPending,
    loadSettingsSnapshot,
    loadedSnapshot,
    onRuntimeAvailabilityError,
    saveGlobalGitConfig,
    saveWithRuntimeReview,
    snapshotDraft,
    validation,
    wasKanbanTaskCardViewEdited,
  ]);

  return {
    runtimeReview,
    confirmRuntimeReview,
    cancelRuntimeReview,
    isSaving,
    saveError,
    clearSaveError,
    submit,
  };
};
