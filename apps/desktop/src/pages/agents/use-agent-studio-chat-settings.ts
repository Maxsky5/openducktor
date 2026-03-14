import type { SettingsSnapshot } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "@/lib/errors";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";

const DEFAULT_SHOW_THINKING_MESSAGES = false;

const readShowThinkingMessages = (snapshot: SettingsSnapshot): boolean => {
  return snapshot.chat.showThinkingMessages;
};

const createChatSettingsLoadError = (activeRepo: string, cause: unknown): Error => {
  return new Error(
    `Failed to load Agent Studio chat settings for "${activeRepo}": ${errorMessage(cause)}`,
    { cause },
  );
};

export function useAgentStudioChatSettings(args: { activeRepo: string | null }): {
  showThinkingMessages: boolean;
  chatSettingsLoadError: Error | null;
  retryChatSettingsLoad: () => void;
} {
  const { activeRepo } = args;

  const {
    data: showThinkingMessages = DEFAULT_SHOW_THINKING_MESSAGES,
    error,
    refetch,
  } = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: activeRepo !== null,
    select: readShowThinkingMessages,
  });

  const retryChatSettingsLoad = useCallback((): void => {
    if (!activeRepo) {
      return;
    }

    void refetch();
  }, [activeRepo, refetch]);

  const chatSettingsLoadError =
    activeRepo && error ? createChatSettingsLoadError(activeRepo, error) : null;

  return {
    showThinkingMessages: activeRepo ? showThinkingMessages : DEFAULT_SHOW_THINKING_MESSAGES,
    chatSettingsLoadError,
    retryChatSettingsLoad,
  };
}
