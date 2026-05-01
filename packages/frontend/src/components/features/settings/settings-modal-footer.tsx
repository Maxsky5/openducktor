import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import type { RepositorySectionId, SettingsSectionId } from "./settings-modal-constants";

type SettingsModalFooterSaveState = {
  isSaving: boolean;
  isLoadingSettings: boolean;
  hasSnapshotDraft: boolean;
  settingsError: string | null;
};

type SettingsModalFooterValidationSummary = {
  promptPlaceholderErrorCount: number;
  customPromptFieldErrorCount: number;
  repoScriptFieldErrorCount: number;
};

type SettingsModalFooterErrors = {
  saveError: string | null;
  catalogError: string | null;
};

type SettingsModalFooterLocation = {
  section: SettingsSectionId;
  repositorySection: RepositorySectionId;
};

type SettingsModalFooterProps = {
  saveState: SettingsModalFooterSaveState;
  validationSummary: SettingsModalFooterValidationSummary;
  errors: SettingsModalFooterErrors;
  location: SettingsModalFooterLocation;
  onCancel: () => void;
  onSave: () => void;
};

export function SettingsModalFooter({
  saveState,
  validationSummary,
  errors,
  location,
  onCancel,
  onSave,
}: SettingsModalFooterProps): ReactElement {
  const hasPromptValidationErrors = validationSummary.promptPlaceholderErrorCount > 0;
  const hasCustomPromptValidationErrors = validationSummary.customPromptFieldErrorCount > 0;
  const hasRepoScriptValidationErrors = validationSummary.repoScriptFieldErrorCount > 0;
  const isSaveDisabled =
    saveState.isSaving ||
    saveState.isLoadingSettings ||
    !saveState.hasSnapshotDraft ||
    Boolean(saveState.settingsError) ||
    hasPromptValidationErrors ||
    hasCustomPromptValidationErrors;

  return (
    <div className="mt-0 flex shrink-0 items-center justify-start border-t border-border px-6 pb-4 pt-4">
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" disabled={saveState.isSaving} onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="flex grow items-center gap-2 text-sm">
        {errors.saveError ? (
          <span className="text-destructive-muted">{errors.saveError}</span>
        ) : (
          <span />
        )}
        {!errors.saveError && hasPromptValidationErrors ? (
          <span className="text-destructive-muted">
            {validationSummary.promptPlaceholderErrorCount} prompt placeholder error
            {validationSummary.promptPlaceholderErrorCount > 1 ? "s" : ""}.
          </span>
        ) : null}
        {!errors.saveError && !hasPromptValidationErrors && hasCustomPromptValidationErrors ? (
          <span className="text-destructive-muted">
            {validationSummary.customPromptFieldErrorCount} custom prompt field error
            {validationSummary.customPromptFieldErrorCount > 1 ? "s" : ""}.
          </span>
        ) : null}
        {!errors.saveError &&
        !hasPromptValidationErrors &&
        !hasCustomPromptValidationErrors &&
        hasRepoScriptValidationErrors ? (
          <span className="text-destructive-muted">
            {validationSummary.repoScriptFieldErrorCount} dev server field error
            {validationSummary.repoScriptFieldErrorCount > 1 ? "s" : ""}.
          </span>
        ) : null}
        {errors.catalogError &&
        location.section === "repositories" &&
        location.repositorySection === "configuration" ? (
          <span className="text-warning-muted">Catalog unavailable.</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" disabled={isSaveDisabled} onClick={onSave}>
          {saveState.isSaving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
