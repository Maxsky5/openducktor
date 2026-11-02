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
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { SettingsSaveOutcome } from "@/types/state-slices";
import {
  getSettingsSaveBlocker,
  hasAnyDirtySections,
  type SettingsSaveValidation,
} from "./settings-modal-save-policy";
import { reportSettingsSaveFollowUps } from "./settings-save/runtime-settings-application";
import { prepareSettingsSnapshotForSave } from "./settings-save/settings-snapshot";
import type { DirtySections } from "./use-settings-modal-dirty-state";

type UseSettingsModalSaveOrchestrationArgs = {
  open: boolean;
  unavailableTargetError?: string | null;
  acknowledgeSave: (partial: boolean, submitted: SettingsSnapshotSaveInput) => void;
  retainDraft: () => void;
  loadedSnapshot: SettingsSnapshot | null;
  snapshotDraft: SettingsSnapshot | null;
  dirtySections: DirtySections;
  validation: SettingsSaveValidation;
  onRuntimeAvailabilityError: (runtimeKind: RuntimeKind) => void;
  previewSettingsSnapshotRuntime: (
    snapshot: SettingsSnapshotSaveInput,
  ) => Promise<SettingsSnapshotRuntimePreview>;
  saveSettingsSnapshot: (
    snapshot: SettingsSnapshotSaveInput,
    runtimeConfirmation?: string,
  ) => Promise<SettingsSaveOutcome>;
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

type ConfirmedSaveResult =
  | { type: "completed"; partial: boolean }
  | Extract<RuntimeImpactActionResult, { type: "impact_changed" }>;

export const useSettingsModalSaveOrchestration = ({
  open,
  unavailableTargetError,
  loadedSnapshot,
  snapshotDraft,
  dirtySections,
  validation,
  onRuntimeAvailabilityError,
  acknowledgeSave,
  retainDraft,
  previewSettingsSnapshotRuntime,
  saveSettingsSnapshot,
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
   * new review. Any other changed impact is saved again once with its new confirmation.
   */
  const saveConfirmed = useCallback(
    async (
      snapshot: SettingsSnapshotSaveInput,
      impact: RuntimeLifecycleImpact | null,
    ): Promise<ConfirmedSaveResult> => {
      let confirmation = impact?.confirmation;
      for (let retried = false; ; retried = true) {
        const result = await saveSettingsSnapshot(snapshot, confirmation);
        if (result.type !== "runtime_impact_changed") {
          acknowledgeSave(result.type === "partial", snapshot);
          reportSettingsSaveFollowUps(result, (title, description) =>
            toast.warning(title, { description }),
          );
          return { type: "completed", partial: result.type === "partial" };
        }
        if (hasLiveSessions(result.impact))
          return { type: "impact_changed", impact: result.impact };
        if (retried)
          throw new Error(
            "The runtime changes of these settings changed again during the save. Wait until the runtimes finish starting or stopping, then save again.",
          );
        confirmation = result.impact.confirmation;
      }
    },
    [acknowledgeSave, saveSettingsSnapshot],
  );

  /**
   * Saves the snapshot and resolves true only when every part saved. When the save stops live
   * sessions, the user reviews them first. A changed impact opens the review again. Cancel keeps
   * the draft and writes nothing.
   */
  const saveWithRuntimeReview = useCallback(
    async (snapshot: SettingsSnapshotSaveInput): Promise<boolean> => {
      const impact = snapshot.global?.agentRuntimes
        ? (await previewSettingsSnapshotRuntime(snapshot)).impact
        : null;
      let notice: string | null = null;
      if (impact === null || !hasLiveSessions(impact)) {
        const result = await saveConfirmed(snapshot, impact);
        if (result.type === "completed") return !result.partial;
        notice = RUNTIME_IMPACT_CHANGED_NOTICE;
      }
      const completed = await openRuntimeReview({
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
      return completed !== null && !completed.partial;
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
    if (saveInFlightRef.current || !snapshotDraft || !loadedSnapshot) {
      return false;
    }

    if (unavailableTargetError) {
      retainDraft();
      setSaveError(unavailableTargetError);
      toast.error("Cannot save settings", { description: unavailableTargetError });
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

    saveInFlightRef.current = true;
    setIsSaving(true);

    try {
      const saveReadySnapshot = prepareSettingsSnapshotForSave(snapshotDraft, loadedSnapshot);
      if (Object.keys(saveReadySnapshot).length === 0) {
        acknowledgeSave(false, saveReadySnapshot);
        return true;
      }
      return await saveWithRuntimeReview(saveReadySnapshot);
    } catch (error: unknown) {
      retainDraft();
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
    loadedSnapshot,
    onRuntimeAvailabilityError,
    retainDraft,
    saveWithRuntimeReview,
    snapshotDraft,
    acknowledgeSave,
    validation,
    unavailableTargetError,
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
