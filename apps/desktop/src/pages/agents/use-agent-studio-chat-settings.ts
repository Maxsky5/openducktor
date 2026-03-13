import type { SettingsSnapshot } from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";

export const SETTINGS_SNAPSHOT_UPDATED_EVENT = "odt:settings-snapshot-updated";

const DEFAULT_SHOW_THINKING_MESSAGES = false;

const readShowThinkingMessages = (snapshot: SettingsSnapshot): boolean => {
  return snapshot.chat?.showThinkingMessages ?? DEFAULT_SHOW_THINKING_MESSAGES;
};

const createChatSettingsLoadError = (activeRepo: string, cause: unknown): Error => {
  return new Error(
    `Failed to load Agent Studio chat settings for "${activeRepo}": ${errorMessage(cause)}`,
    { cause },
  );
};

export function useAgentStudioChatSettings(args: {
  activeRepo: string | null;
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>;
}): {
  showThinkingMessages: boolean;
  chatSettingsLoadError: Error | null;
  retryChatSettingsLoad: () => void;
} {
  const { activeRepo, loadSettingsSnapshot } = args;
  const [showThinkingMessages, setShowThinkingMessages] = useState(DEFAULT_SHOW_THINKING_MESSAGES);
  const [chatSettingsLoadError, setChatSettingsLoadError] = useState<Error | null>(null);
  const latestReloadIdRef = useRef(0);

  const reloadChatSettings = useCallback(() => {
    if (!activeRepo) {
      latestReloadIdRef.current += 1;
      setShowThinkingMessages(DEFAULT_SHOW_THINKING_MESSAGES);
      setChatSettingsLoadError(null);
      return () => {};
    }

    const repoPath = activeRepo;
    const reloadId = latestReloadIdRef.current + 1;
    latestReloadIdRef.current = reloadId;
    let cancelled = false;

    void loadSettingsSnapshot()
      .then((snapshot) => {
        if (!cancelled && reloadId === latestReloadIdRef.current) {
          setShowThinkingMessages(readShowThinkingMessages(snapshot));
          setChatSettingsLoadError(null);
        }
      })
      .catch((cause) => {
        if (!cancelled && reloadId === latestReloadIdRef.current) {
          setChatSettingsLoadError(createChatSettingsLoadError(repoPath, cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, loadSettingsSnapshot]);

  const retryChatSettingsLoad = useCallback((): void => {
    reloadChatSettings();
  }, [reloadChatSettings]);

  useEffect(() => {
    return reloadChatSettings();
  }, [reloadChatSettings]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleSettingsSnapshotUpdated = () => {
      reloadChatSettings();
    };

    window.addEventListener(SETTINGS_SNAPSHOT_UPDATED_EVENT, handleSettingsSnapshotUpdated);
    return () => {
      window.removeEventListener(SETTINGS_SNAPSHOT_UPDATED_EVENT, handleSettingsSnapshotUpdated);
    };
  }, [reloadChatSettings]);

  return {
    showThinkingMessages,
    chatSettingsLoadError,
    retryChatSettingsLoad,
  };
}
