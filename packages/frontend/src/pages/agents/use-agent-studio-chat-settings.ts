import type { ChatSettings, ReusablePrompt, SettingsSnapshot } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useWorkspaceChatSettings } from "@openducktor/frontend-core/queries/use-workspace-chat-settings";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";

const DEFAULT_REUSABLE_PROMPTS: ReusablePrompt[] = [];

const readReusablePrompts = (snapshot: SettingsSnapshot): ReusablePrompt[] =>
  snapshot.reusablePrompts;

const createChatSettingsLoadError = (workspaceRepoPath: string, cause: unknown): Error => {
  return new Error(
    `Failed to load task session chat settings for "${workspaceRepoPath}": ${errorMessage(cause)}`,
    { cause },
  );
};

export function useAgentStudioChatSettings(args: { workspaceRepoPath: string | null }) {
  const { workspaceRepoPath } = args;
  const hasWorkspace = workspaceRepoPath !== null;
  const { chatSettings, chatSettingsError, retryChatSettingsLoad } = useWorkspaceChatSettings({
    hasWorkspace,
  });

  const { data: reusablePrompts, error: reusablePromptsError } = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: hasWorkspace,
    select: readReusablePrompts,
  });

  const settingsError = chatSettingsError ?? reusablePromptsError;
  const chatSettingsLoadError =
    workspaceRepoPath && settingsError
      ? createChatSettingsLoadError(workspaceRepoPath, settingsError)
      : null;

  return {
    chatSettings,
    reusablePrompts: hasWorkspace
      ? (reusablePrompts ?? DEFAULT_REUSABLE_PROMPTS)
      : DEFAULT_REUSABLE_PROMPTS,
    chatSettingsLoadError,
    retryChatSettingsLoad,
  } satisfies {
    chatSettings: ChatSettings | null;
    reusablePrompts: ReusablePrompt[];
    chatSettingsLoadError: Error | null;
    retryChatSettingsLoad: () => void;
  };
}
