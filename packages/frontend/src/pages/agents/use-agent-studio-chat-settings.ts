import type { ChatSettings, ReusablePrompt, SettingsSnapshot } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceChatSettings } from "@/state/queries/use-workspace-chat-settings";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import type { ActiveWorkspace } from "@/types/state-slices";

const DEFAULT_REUSABLE_PROMPTS: ReusablePrompt[] = [];

const readReusablePrompts = (snapshot: SettingsSnapshot): ReusablePrompt[] =>
  snapshot.reusablePrompts;

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
  const { chatSettings, chatSettingsError, retryChatSettingsLoad } = useWorkspaceChatSettings({
    activeWorkspace,
  });

  const { data: reusablePrompts, error: reusablePromptsError } = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: activeWorkspace !== null,
    select: readReusablePrompts,
  });

  const settingsError = chatSettingsError ?? reusablePromptsError;
  const chatSettingsLoadError =
    activeRepoPath && settingsError
      ? createChatSettingsLoadError(activeRepoPath, settingsError)
      : null;

  return {
    chatSettings,
    reusablePrompts: activeWorkspace
      ? (reusablePrompts ?? DEFAULT_REUSABLE_PROMPTS)
      : DEFAULT_REUSABLE_PROMPTS,
    chatSettingsLoadError,
    retryChatSettingsLoad,
  };
}
