import type { ChatSettings, ReusablePrompt, SettingsSnapshot } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "@/lib/errors";
import {
  DEFAULT_CHAT_SETTINGS,
  readChatSettingsFromSnapshot,
  settingsSnapshotQueryOptions,
} from "@/state/queries/workspace";
import type { ActiveWorkspace } from "@/types/state-slices";

const DEFAULT_SHOW_THINKING_MESSAGES = DEFAULT_CHAT_SETTINGS.showThinkingMessages;
const DEFAULT_EXPAND_FILE_DIFFS_BY_DEFAULT = DEFAULT_CHAT_SETTINGS.expandFileDiffsByDefault;
const DEFAULT_REUSABLE_PROMPTS: ReusablePrompt[] = [];

type AgentStudioChatSettings = {
  showThinkingMessages: boolean;
  expandFileDiffsByDefault: boolean;
  reusablePrompts: ReusablePrompt[];
};

const readAgentStudioChatSettings = (snapshot: SettingsSnapshot): AgentStudioChatSettings => {
  const chat: ChatSettings = readChatSettingsFromSnapshot(snapshot);
  return {
    showThinkingMessages: chat.showThinkingMessages,
    expandFileDiffsByDefault: chat.expandFileDiffsByDefault,
    reusablePrompts: snapshot.reusablePrompts,
  };
};

const createChatSettingsLoadError = (workspaceRepoPath: string, cause: unknown): Error => {
  return new Error(
    `Failed to load Agent Studio chat settings for "${workspaceRepoPath}": ${errorMessage(cause)}`,
    { cause },
  );
};

export function useAgentStudioChatSettings(args: { activeWorkspace: ActiveWorkspace | null }): {
  showThinkingMessages: boolean;
  expandFileDiffsByDefault: boolean;
  reusablePrompts: ReusablePrompt[];
  chatSettingsLoadError: Error | null;
  retryChatSettingsLoad: () => void;
} {
  const { activeWorkspace } = args;
  const activeRepoPath = activeWorkspace?.repoPath ?? null;

  const {
    data: chatSettings,
    error,
    refetch,
  } = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: activeWorkspace !== null,
    select: readAgentStudioChatSettings,
  });

  const retryChatSettingsLoad = useCallback((): void => {
    if (!activeWorkspace) {
      return;
    }

    void refetch();
  }, [activeWorkspace, refetch]);

  const chatSettingsLoadError =
    activeRepoPath && error ? createChatSettingsLoadError(activeRepoPath, error) : null;

  return {
    showThinkingMessages: activeWorkspace
      ? (chatSettings?.showThinkingMessages ?? DEFAULT_SHOW_THINKING_MESSAGES)
      : DEFAULT_SHOW_THINKING_MESSAGES,
    expandFileDiffsByDefault: activeWorkspace
      ? (chatSettings?.expandFileDiffsByDefault ?? DEFAULT_EXPAND_FILE_DIFFS_BY_DEFAULT)
      : DEFAULT_EXPAND_FILE_DIFFS_BY_DEFAULT,
    reusablePrompts: activeWorkspace
      ? (chatSettings?.reusablePrompts ?? DEFAULT_REUSABLE_PROMPTS)
      : DEFAULT_REUSABLE_PROMPTS,
    chatSettingsLoadError,
    retryChatSettingsLoad,
  };
}
