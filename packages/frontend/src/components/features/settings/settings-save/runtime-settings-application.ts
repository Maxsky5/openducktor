import {
  type AgentRuntimes,
  knownRuntimeKindValues,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeLifecycleImpact,
  type RuntimeSettingsApplication,
} from "@openducktor/contracts";
import type { RuntimeImpactPathChange } from "@/components/features/runtimes/runtime-impact-dialog";
import type { SettingsSaveOutcome } from "@/types/state-slices";

/** A save changes a runtime lifecycle only through `enabled` or `executablePath`. */
export const hasRuntimeLifecycleChange = (before: AgentRuntimes, after: AgentRuntimes): boolean =>
  knownRuntimeKindValues.some(
    (kind) =>
      before[kind].enabled !== after[kind].enabled ||
      before[kind].executablePath !== after[kind].executablePath,
  );

export const runtimeImpactPathChanges = (
  impact: RuntimeLifecycleImpact,
): RuntimeImpactPathChange[] =>
  impact.kinds
    .filter((kind) => kind.effect === "replace")
    .map((kind) => ({
      kind: kind.kind,
      label: RUNTIME_DESCRIPTORS_BY_KIND[kind.kind].label,
      oldExecutablePath: kind.oldExecutablePath,
      newExecutablePath: kind.newExecutablePath,
    }));

/**
 * Accepts only a written save. A save that would stop live sessions needs the review in
 * Settings, so this path fails with that next action.
 */
export const requireSavedSettings = (
  result: SettingsSaveOutcome,
): Extract<SettingsSaveOutcome, { type: "saved" }> => {
  if (result.type === "saved") return result;
  throw new Error(
    "This change stops live agent sessions. Open Settings to review the sessions, then save again.",
  );
};

/** Reports what a written save could not finish, apart from the save itself. */
export const reportSettingsSaveFollowUps = (
  result: Extract<SettingsSaveOutcome, { type: "saved" }>,
  warn: (title: string, description: string) => void,
): void => {
  const failures = describeRuntimeApplicationFailures(result.runtimeApplications);
  if (failures) warn("Settings saved, but a runtime change failed", failures);
  if (result.refreshError) {
    warn(
      "Settings saved, but the app could not reload them",
      `${result.refreshError} Reopen Settings to see the saved values.`,
    );
  }
};

/** Describes runtime changes that failed after the settings were saved. */
const describeRuntimeApplicationFailures = (
  applications: ReadonlyArray<RuntimeSettingsApplication>,
): string | null => {
  const failures = applications
    .filter((application) => application.outcome === "failed")
    .map(
      (application) =>
        `${RUNTIME_DESCRIPTORS_BY_KIND[application.kind].label}: ${
          application.message ?? "The runtime change failed."
        }`,
    );
  if (failures.length === 0) return null;
  return `${failures.join(" ")} Check Diagnostics to restart the runtime or retry the change.`;
};
