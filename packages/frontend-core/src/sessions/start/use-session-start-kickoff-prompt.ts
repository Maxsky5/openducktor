import { promptSettingsOf } from "@openducktor/workflows";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { errorMessage } from "../../lib/errors";
import { targetBranchFromSelection } from "../../lib/target-branch";
import { repoConfigQueryOptions, settingsSnapshotQueryOptions } from "../../queries/workspace";
import {
  buildSessionStartKickoffPrompt,
  type SessionStartKickoffInput,
} from "./session-start-kickoff";

/** Builds the preview from cached settings. Only missing settings need preparation. */
export function useSessionStartKickoffPrompt({
  kickoff,
  selectedTargetBranch,
}: {
  kickoff: SessionStartKickoffInput | undefined;
  selectedTargetBranch: string;
}) {
  const workspaceId = kickoff?.workspaceId ?? null;
  const enabled = kickoff !== undefined && workspaceId !== null;
  const config = useQuery({ ...repoConfigQueryOptions(workspaceId ?? ""), enabled });
  const settings = useQuery({ ...settingsSnapshotQueryOptions(), enabled });
  const isKickoffPromptLoading = enabled && (config.isPending || settings.isPending);
  const result = useMemo(() => {
    if (!kickoff || isKickoffPromptLoading) return {};
    const readError = enabled
      ? ((config.data ? null : config.error) ?? (settings.data ? null : settings.error))
      : null;
    if (readError) return { error: errorMessage(readError) };
    try {
      if (!kickoff.task) throw new Error("The task workflow is unavailable. Reload the task.");
      const intent = { ...kickoff.request };
      if (selectedTargetBranch)
        intent.targetBranch = targetBranchFromSelection(selectedTargetBranch);
      return {
        text: buildSessionStartKickoffPrompt({
          intent,
          task: kickoff.task,
          repoDefaultTargetBranch: enabled ? (config.data?.defaultTargetBranch ?? null) : null,
          settings:
            enabled && config.data && settings.data
              ? promptSettingsOf(settings.data, config.data)
              : undefined,
        }),
      };
    } catch (cause) {
      return { error: errorMessage(cause) };
    }
  }, [
    kickoff,
    selectedTargetBranch,
    enabled,
    isKickoffPromptLoading,
    config.data,
    config.error,
    settings.data,
    settings.error,
  ]);
  const { refetch: retryConfig } = config;
  const { refetch: retrySettings } = settings;
  const retry = useCallback(() => {
    if (enabled) void Promise.all([retryConfig(), retrySettings()]);
  }, [enabled, retryConfig, retrySettings]);
  return {
    kickoffPrompt: result.text,
    isKickoffPromptLoading,
    kickoffPromptError: result.error ?? null,
    onRetryKickoffPrompt: retry,
  };
}
