import type { RepoConfig, SettingsSnapshot } from "@openducktor/contracts";
import { useMemo } from "react";
import {
  buildDevServerDraftValidationMap,
  countDevServerDraftValidationErrors,
} from "./settings-model";

type UseSettingsModalRepoScriptValidationArgs = {
  snapshotDraft: SettingsSnapshot | null;
  selectedRepoConfig: RepoConfig | null;
};

type SettingsModalRepoScriptValidation = {
  selectedRepoDevServerValidationErrors: Record<string, { name?: string; command?: string }>;
  invalidRepoPathsWithDevServerErrors: string[];
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

    return buildDevServerDraftValidationMap(selectedRepoConfig.devServers ?? []);
  }, [selectedRepoConfig]);

  const repoScriptValidationSummary = useMemo(() => {
    if (!snapshotDraft) {
      return {
        invalidRepoPathsWithDevServerErrors: [] as string[],
        repoScriptValidationErrorCount: 0,
      };
    }

    const invalidRepoPathsWithDevServerErrors: string[] = [];
    let repoScriptValidationErrorCount = 0;

    for (const [workspaceId, repoConfig] of Object.entries(snapshotDraft.workspaces)) {
      const errorCount = countDevServerDraftValidationErrors(repoConfig.devServers ?? []);
      if (errorCount > 0) {
        invalidRepoPathsWithDevServerErrors.push(workspaceId);
        repoScriptValidationErrorCount += errorCount;
      }
    }

    invalidRepoPathsWithDevServerErrors.sort();

    return {
      invalidRepoPathsWithDevServerErrors,
      repoScriptValidationErrorCount,
    };
  }, [snapshotDraft]);

  return {
    selectedRepoDevServerValidationErrors,
    invalidRepoPathsWithDevServerErrors:
      repoScriptValidationSummary.invalidRepoPathsWithDevServerErrors,
    repoScriptValidationErrorCount: repoScriptValidationSummary.repoScriptValidationErrorCount,
    hasRepoScriptValidationErrors: repoScriptValidationSummary.repoScriptValidationErrorCount > 0,
  };
};
