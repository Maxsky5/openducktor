import type { AgentRuntimes, NotificationSettings, SettingsSnapshot } from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { prepareSettingsSnapshotForSave } from "@/components/features/settings/settings-save/settings-snapshot";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceState } from "@/state/app-state-provider";

export const useOnboardingNotificationSetup = ({
  settingsSnapshot,
  agentRuntimes,
  onContinue,
}: {
  settingsSnapshot: SettingsSnapshot | undefined;
  agentRuntimes: AgentRuntimes | null;
  onContinue: () => void;
}) => {
  const { saveSettingsSnapshot } = useWorkspaceState();
  const [notificationDraft, setNotificationDraft] = useState<NotificationSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const saveErrorRef = useRef<HTMLParagraphElement>(null);
  const notifications = notificationDraft ?? settingsSnapshot?.notifications ?? null;

  useEffect(() => {
    if (saveError) saveErrorRef.current?.focus();
  }, [saveError]);

  const updateNotifications = useCallback(
    (updater: (current: NotificationSettings) => NotificationSettings): void => {
      setSaveError(null);
      setNotificationDraft((currentDraft) => {
        const current = currentDraft ?? settingsSnapshot?.notifications;
        return current ? updater(current) : currentDraft;
      });
    },
    [settingsSnapshot?.notifications],
  );

  const saveNotifications = useCallback(async (): Promise<void> => {
    if (saveInFlight.current) return;
    if (!settingsSnapshot || !agentRuntimes || !notifications) {
      setSaveError("Notification settings must load before you can continue.");
      return;
    }
    if (!notificationDraft) {
      onContinue();
      return;
    }

    saveInFlight.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveSettingsSnapshot(
        prepareSettingsSnapshotForSave({
          ...settingsSnapshot,
          agentRuntimes,
          notifications,
        }),
      );
      onContinue();
    } catch (cause) {
      setSaveError(errorMessage(cause));
    } finally {
      saveInFlight.current = false;
      setIsSaving(false);
    }
  }, [
    agentRuntimes,
    notificationDraft,
    notifications,
    onContinue,
    saveSettingsSnapshot,
    settingsSnapshot,
  ]);

  return {
    notifications,
    isSaving,
    saveError,
    saveErrorRef,
    updateNotifications,
    saveNotifications,
  };
};
