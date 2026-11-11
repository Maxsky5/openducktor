import type { RepositorySectionId, SettingsSectionId } from "./settings-modal-constants";

type SettingsModalFooterSaveState = {
  isSaving: boolean;
  isLoadingSettings: boolean;
  hasSnapshotDraft: boolean;
  settingsError: string | null;
  isLoadingRuntimeConfiguration: boolean;
};

type SettingsModalFooterValidationSummary = {
  customAgentRoleFieldErrorCount: number;
  promptPlaceholderErrorCount: number;
  /** Where the first prompt placeholder error is, such as "Fix Kickoff (Bug Triage, System prompts)". */
  promptPlaceholderErrorPlace: string | null;
  reusablePromptFieldErrorCount: number;
  runtimeAvailabilityErrorCount: number;
  claudeSettingsError?: string | null | undefined;
  openCodePermissionErrorCount: number;
  hasUnacknowledgedCodexDangerousSettings: boolean;
};

type SettingsModalFooterErrors = {
  saveError: string | null;
  catalogError: string | null;
  runtimeExecutablesError: string | null;
};

type SettingsModalFooterLocation = {
  section: SettingsSectionId;
  repositorySection: RepositorySectionId;
};

export type SettingsModalFooterState = {
  saveState: SettingsModalFooterSaveState;
  validationSummary: SettingsModalFooterValidationSummary;
  errors: SettingsModalFooterErrors;
  location: SettingsModalFooterLocation;
};

const fieldErrors = (count: number, label: string): string | null =>
  count > 0 ? `${count} ${label} error${count > 1 ? "s" : ""}.` : null;

/** The prompt errors, with the place of the first one, so the user can find it. */
const promptErrors = (count: number, place: string | null | undefined): string | null => {
  if (count === 0) return null;
  if (!place) return fieldErrors(count, "prompt placeholder");
  return count === 1
    ? `Fix the placeholder error in ${place}.`
    : `Fix ${count} prompt placeholder errors. The first is in ${place}.`;
};

const validationMessage = (summary: SettingsModalFooterValidationSummary): string | null =>
  fieldErrors(summary.openCodePermissionErrorCount, "OpenCode permission field") ??
  promptErrors(summary.promptPlaceholderErrorCount, summary.promptPlaceholderErrorPlace) ??
  fieldErrors(summary.reusablePromptFieldErrorCount, "reusable prompt field") ??
  fieldErrors(summary.runtimeAvailabilityErrorCount, "runtime executable") ??
  summary.claudeSettingsError ??
  (summary.hasUnacknowledgedCodexDangerousSettings
    ? "Confirm the Codex safety acknowledgement before saving."
    : null);

export function resolveSettingsModalFooter({
  saveState,
  validationSummary,
  errors,
  location,
}: SettingsModalFooterState) {
  const isSaveDisabled =
    saveState.isSaving ||
    saveState.isLoadingSettings ||
    !saveState.hasSnapshotDraft ||
    Boolean(saveState.settingsError) ||
    saveState.isLoadingRuntimeConfiguration ||
    Boolean(errors.catalogError) ||
    Boolean(errors.runtimeExecutablesError) ||
    validationSummary.openCodePermissionErrorCount > 0 ||
    validationSummary.promptPlaceholderErrorCount > 0 ||
    validationSummary.reusablePromptFieldErrorCount > 0 ||
    validationSummary.customAgentRoleFieldErrorCount > 0 ||
    validationSummary.runtimeAvailabilityErrorCount > 0 ||
    Boolean(validationSummary.claudeSettingsError) ||
    validationSummary.hasUnacknowledgedCodexDangerousSettings;
  const messages: Array<{ id: string; text: string }> = [];
  if (errors.saveError) {
    messages.push({ id: "save", text: errors.saveError });
  } else {
    const roles = fieldErrors(
      validationSummary.customAgentRoleFieldErrorCount,
      "custom role field",
    );
    if (roles) messages.push({ id: "roles", text: roles });
    const validation = validationMessage(validationSummary);
    if (validation) messages.push({ id: "validation", text: validation });
  }
  if (
    errors.catalogError &&
    (location.section === "runtimes" ||
      (location.section === "repositories" && location.repositorySection === "configuration"))
  ) {
    messages.push({
      id: "catalog",
      text: `Could not load runtimes: ${errors.catalogError}`,
    });
  }
  if (errors.runtimeExecutablesError && location.section === "runtimes") {
    messages.push({
      id: "runtime",
      text: `Runtime executable check failed: ${errors.runtimeExecutablesError}`,
    });
  }
  return { isSaveDisabled, messages };
}
