import type { RepoConfig, SettingsSnapshot } from "@openducktor/contracts";
import { useMemo } from "react";
import {
  buildDevServerDraftValidationMap,
  countDevServerDraftValidationErrors,
} from "@/state/read-models/settings-read-model";

type UseSettingsModalRepoScriptValidationArgs = {
  snapshotDraft: SettingsSnapshot | null;
  selectedRepoConfig: RepoConfig | null;
};

type SettingsModalRepoScriptValidation = {
  selectedRepoDevServerValidationErrors: Record<string, { name?: string; command?: string }>;
  invalidRepoPathsWithDevServerErrors: string[];
  repoScriptValidationErrorCountByWorkspaceId: Record<string, number>;
  repoScriptValidationErrorCount: number;
  hasRepoScriptValidationErrors: boolean;
};

export const useSettingsModalRepoScriptValidation = ({
  snapshotDraft,
  selectedRepoConfig,
}: UseSettingsModalRepoScriptValidationArgs): SettingsModalRepoScriptValidation => {
  const selectedRepoDevServerValidationErrors = useMemo(() => {
    if (!selectedRepoConfig) {
      return {};
    }

    return buildDevServerDraftValidationMap(selectedRepoConfig.devServers);
  }, [selectedRepoConfig]);

  const repoScriptValidationSummary = useMemo(() => {
    if (!snapshotDraft) {
      return {
        invalidRepoPathsWithDevServerErrors: [] as string[],
        repoScriptValidationErrorCountByWorkspaceId: {} as Record<string, number>,
        repoScriptValidationErrorCount: 0,
      };
    }

    const invalidRepoPathsWithDevServerErrors: string[] = [];
    const repoScriptValidationErrorCountByWorkspaceId: Record<string, number> = {};
    let repoScriptValidationErrorCount = 0;

    for (const [workspaceId, repoConfig] of Object.entries(snapshotDraft.workspaces)) {
      const errorCount = countDevServerDraftValidationErrors(repoConfig.devServers);
      if (errorCount > 0) {
        invalidRepoPathsWithDevServerErrors.push(workspaceId);
        repoScriptValidationErrorCountByWorkspaceId[workspaceId] = errorCount;
        repoScriptValidationErrorCount += errorCount;
      }
    }

    invalidRepoPathsWithDevServerErrors.sort();

    return {
      invalidRepoPathsWithDevServerErrors,
      repoScriptValidationErrorCountByWorkspaceId,
      repoScriptValidationErrorCount,
    };
  }, [snapshotDraft]);

  return {
    selectedRepoDevServerValidationErrors,
    invalidRepoPathsWithDevServerErrors:
      repoScriptValidationSummary.invalidRepoPathsWithDevServerErrors,
    repoScriptValidationErrorCountByWorkspaceId:
      repoScriptValidationSummary.repoScriptValidationErrorCountByWorkspaceId,
    repoScriptValidationErrorCount: repoScriptValidationSummary.repoScriptValidationErrorCount,
    hasRepoScriptValidationErrors: repoScriptValidationSummary.repoScriptValidationErrorCount > 0,
  };
};
