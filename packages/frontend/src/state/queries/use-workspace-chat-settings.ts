import { type ChatSettings, DEFAULT_CHAT_SETTINGS } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { readChatSettingsFromSnapshot, settingsSnapshotQueryOptions } from "./workspace";

export function useWorkspaceChatSettings({ hasWorkspace }: { hasWorkspace: boolean }): {
  chatSettings: ChatSettings;
  chatSettingsError: Error | null;
  retryChatSettingsLoad: () => void;
} {
  const {
    data: chatSettings,
    error,
    refetch,
  } = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: hasWorkspace,
    select: readChatSettingsFromSnapshot,
  });

  const retryChatSettingsLoad = useCallback((): void => {
    if (!hasWorkspace) {
      return;
    }

    void refetch();
  }, [hasWorkspace, refetch]);

  return {
    chatSettings: hasWorkspace ? (chatSettings ?? DEFAULT_CHAT_SETTINGS) : DEFAULT_CHAT_SETTINGS,
    chatSettingsError: hasWorkspace ? error : null,
    retryChatSettingsLoad,
  };
}
