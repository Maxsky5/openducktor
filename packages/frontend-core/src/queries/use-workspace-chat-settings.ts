import type { ChatSettings } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { readChatSettingsFromSnapshot, settingsSnapshotQueryOptions } from "./workspace";

export function useWorkspaceChatSettings({ hasWorkspace }: { hasWorkspace: boolean }) {
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
    chatSettings: hasWorkspace ? (chatSettings ?? null) : null,
    chatSettingsError: hasWorkspace ? error : null,
    retryChatSettingsLoad,
  } satisfies {
    chatSettings: ChatSettings | null;
    chatSettingsError: Error | null;
    retryChatSettingsLoad: () => void;
  };
}
