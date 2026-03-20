import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import type { RepositorySectionId, SettingsSectionId } from "./settings-modal-constants";
import type { PromptValidationState } from "./settings-modal-controller.types";

type SettingsModalFooterProps = {
  isSaving: boolean;
  isLoadingSettings: boolean;
  hasPromptValidationErrors: boolean;
  hasRepoScriptValidationErrors: boolean;
  settingsError: string | null;
  saveError: string | null;
  catalogError: string | null;
  section: SettingsSectionId;
  repositorySection: RepositorySectionId;
  promptValidationState: PromptValidationState;
  repoScriptValidationErrorCount: number;
  hasSnapshotDraft: boolean;
  onCancel: () => void;
  onSave: () => void;
};

export function SettingsModalFooter({
  isSaving,
  isLoadingSettings,
  hasPromptValidationErrors,
  hasRepoScriptValidationErrors,
  settingsError,
  saveError,
  catalogError,
  section,
  repositorySection,
  promptValidationState,
  repoScriptValidationErrorCount,
  hasSnapshotDraft,
  onCancel,
  onSave,
}: SettingsModalFooterProps): ReactElement {
  const isSaveDisabled =
    isSaving ||
    isLoadingSettings ||
    !hasSnapshotDraft ||
    Boolean(settingsError) ||
    hasPromptValidationErrors ||
    hasRepoScriptValidationErrors;

  return (
    <div className="mt-0 flex shrink-0 items-center justify-start border-t border-border px-6 pb-4 pt-4">
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" disabled={isSaving} onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="flex grow items-center gap-2 text-sm">
        {saveError ? <span className="text-destructive-muted">{saveError}</span> : <span />}
        {!saveError && hasPromptValidationErrors ? (
          <span className="text-destructive-muted">
            {promptValidationState.totalErrorCount} prompt placeholder error
            {promptValidationState.totalErrorCount > 1 ? "s" : ""}.
          </span>
        ) : null}
        {!saveError && !hasPromptValidationErrors && hasRepoScriptValidationErrors ? (
          <span className="text-destructive-muted">
            {repoScriptValidationErrorCount} dev server field error
            {repoScriptValidationErrorCount > 1 ? "s" : ""}.
          </span>
        ) : null}
        {catalogError && section === "repositories" && repositorySection === "configuration" ? (
          <span className="text-warning-muted">Catalog unavailable.</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" disabled={isSaveDisabled} onClick={onSave}>
          {isSaving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
