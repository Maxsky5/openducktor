import { type ChatSettings, DEFAULT_CHAT_SETTINGS } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import type { ActiveWorkspace } from "@/types/state-slices";
import { readChatSettingsFromSnapshot, settingsSnapshotQueryOptions } from "./workspace";

export function useWorkspaceChatSettings({
  activeWorkspace,
}: {
  activeWorkspace: ActiveWorkspace | null;
}): {
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
    enabled: activeWorkspace !== null,
    select: readChatSettingsFromSnapshot,
  });

  const retryChatSettingsLoad = useCallback((): void => {
    if (!activeWorkspace) {
      return;
    }

    void refetch();
  }, [activeWorkspace, refetch]);

  return {
    chatSettings: activeWorkspace ? (chatSettings ?? DEFAULT_CHAT_SETTINGS) : DEFAULT_CHAT_SETTINGS,
    chatSettingsError: activeWorkspace ? error : null,
    retryChatSettingsLoad,
  };
}
