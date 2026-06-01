import {
  type ChatSettings,
  DEFAULT_CHAT_SETTINGS,
  type ReusablePrompt,
  type SettingsSnapshot,
} from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "@/lib/errors";
import {
  readChatSettingsFromSnapshot,
  settingsSnapshotQueryOptions,
} from "@/state/queries/workspace";
import type { ActiveWorkspace } from "@/types/state-slices";

const DEFAULT_REUSABLE_PROMPTS: ReusablePrompt[] = [];

type AgentStudioChatSettings = {
  chatSettings: ChatSettings;
  reusablePrompts: ReusablePrompt[];
};

const readAgentStudioChatSettings = (snapshot: SettingsSnapshot): AgentStudioChatSettings => {
  return {
    chatSettings: readChatSettingsFromSnapshot(snapshot),
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
  chatSettings: ChatSettings;
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
    chatSettings: activeWorkspace
      ? (chatSettings?.chatSettings ?? DEFAULT_CHAT_SETTINGS)
      : DEFAULT_CHAT_SETTINGS,
    reusablePrompts: activeWorkspace
      ? (chatSettings?.reusablePrompts ?? DEFAULT_REUSABLE_PROMPTS)
      : DEFAULT_REUSABLE_PROMPTS,
    chatSettingsLoadError,
    retryChatSettingsLoad,
  };
}
