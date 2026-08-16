import type { RuntimeKind, SettingsSnapshot } from "@openducktor/contracts";
import { prepareGlobalGitSettingsForSave } from "./settings-save/global-git-settings";
import { type DirtySections, EMPTY_DIRTY_SECTIONS } from "./use-settings-modal-dirty-state";

const DIRTY_SECTION_KEYS = Object.keys(EMPTY_DIRTY_SECTIONS) as (keyof DirtySections)[];

export const hasAnyDirtySections = (dirtySections: DirtySections): boolean =>
  DIRTY_SECTION_KEYS.some((section) => Boolean(dirtySections[section]));

export const isGlobalGitOnlySave = (dirtySections: DirtySections): boolean =>
  dirtySections.globalGit &&
  DIRTY_SECTION_KEYS.every((section) => section === "globalGit" || !dirtySections[section]);

export const hasSameSaveReadyGlobalGitConfig = (
  loadedSnapshot: SettingsSnapshot | null,
  saveReadyGit: SettingsSnapshot["git"],
): boolean =>
  loadedSnapshot !== null &&
  prepareGlobalGitSettingsForSave(loadedSnapshot.git).defaultMergeMethod ===
    saveReadyGit.defaultMergeMethod;

export const buildPromptValidationSaveError = (totalErrorCount: number): string => {
  const suffix = totalErrorCount > 1 ? "s" : "";
  return `Fix ${totalErrorCount} prompt placeholder error${suffix} before saving.`;
};

export const buildReusablePromptValidationSaveError = (totalErrorCount: number): string => {
  const suffix = totalErrorCount > 1 ? "s" : "";
  return `Fix ${totalErrorCount} reusable prompt field error${suffix} before saving.`;
};

export const buildRuntimeAvailabilitySaveError = (totalErrorCount: number): string => {
  const suffix = totalErrorCount > 1 ? "s" : "";
  return `Fix ${totalErrorCount} runtime executable error${suffix} before saving.`;
};

export const buildCodexDangerousSettingsSaveError = (): string =>
  "Confirm the Codex safety acknowledgement before saving.";

export const buildRepoScriptValidationSaveError = ({
  invalidRepoPathsWithDevServerErrors,
  repoScriptValidationErrorCount,
  selectedWorkspaceId,
}: {
  invalidRepoPathsWithDevServerErrors: string[];
  repoScriptValidationErrorCount: number;
  selectedWorkspaceId: string | null;
}): string => {
  const suffix = repoScriptValidationErrorCount > 1 ? "s" : "";
  const invalidRepoSummary = invalidRepoPathsWithDevServerErrors
    .map((workspaceId) =>
      workspaceId === selectedWorkspaceId ? "the selected repository" : `\`${workspaceId}\``,
    )
    .join(", ");

  return `Fix ${repoScriptValidationErrorCount} dev server field error${suffix} in ${invalidRepoSummary} before saving.`;
};

export type SettingsSaveValidation = {
  prompt: { hasErrors: boolean; errorCount: number };
  reusablePrompts: { hasErrors: boolean; errorCount: number };
  runtimeRequest: { isPending: boolean; error: string | null };
  runtimeAvailability: {
    hasErrors: boolean;
    errorCount: number;
    invalidKind: RuntimeKind | null;
  };
  hasUnacknowledgedCodexDangerousSettings: boolean;
  repoScripts: {
    hasErrors: boolean;
    errorCount: number;
    invalidRepoPaths: string[];
    selectedWorkspaceId: string | null;
  };
};

export type SettingsSaveBlocker = {
  reason: string;
  runtimeKind: RuntimeKind | null;
  showRepoScriptErrors: boolean;
};

const saveBlocker = (
  reason: string,
  options: Pick<SettingsSaveBlocker, "runtimeKind" | "showRepoScriptErrors"> = {
    runtimeKind: null,
    showRepoScriptErrors: false,
  },
): SettingsSaveBlocker => ({ reason, ...options });

export const getSettingsSaveBlocker = (
  validation: SettingsSaveValidation,
): SettingsSaveBlocker | null => {
  if (validation.prompt.hasErrors) {
    return saveBlocker(buildPromptValidationSaveError(validation.prompt.errorCount));
  }
  if (validation.reusablePrompts.hasErrors) {
    return saveBlocker(
      buildReusablePromptValidationSaveError(validation.reusablePrompts.errorCount),
    );
  }
  if (validation.runtimeRequest.error) {
    return saveBlocker(`Runtime configuration check failed: ${validation.runtimeRequest.error}`);
  }
  if (validation.runtimeRequest.isPending) {
    return saveBlocker("Wait for runtime configuration checks to finish before saving.");
  }
  if (validation.runtimeAvailability.hasErrors) {
    return saveBlocker(
      buildRuntimeAvailabilitySaveError(validation.runtimeAvailability.errorCount),
      {
        runtimeKind: validation.runtimeAvailability.invalidKind,
        showRepoScriptErrors: false,
      },
    );
  }
  if (validation.hasUnacknowledgedCodexDangerousSettings) {
    return saveBlocker(buildCodexDangerousSettingsSaveError());
  }
  if (validation.repoScripts.hasErrors) {
    return saveBlocker(
      buildRepoScriptValidationSaveError({
        invalidRepoPathsWithDevServerErrors: validation.repoScripts.invalidRepoPaths,
        repoScriptValidationErrorCount: validation.repoScripts.errorCount,
        selectedWorkspaceId: validation.repoScripts.selectedWorkspaceId,
      }),
      { runtimeKind: null, showRepoScriptErrors: true },
    );
  }
  return null;
};
