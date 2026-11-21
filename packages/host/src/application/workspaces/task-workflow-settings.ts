import type { RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  applyGlobalTaskWorkflowSettings,
  applyTaskWorkflowSettings,
  requireKnownActiveRole,
  savedWorkflowSettingKeys,
  validateRepoTaskWorkflowSettings,
  type WorkflowSettingsSource,
} from "../../config/workflow-settings";
import { HostValidationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";

/** Reads the latest workflow versions and the role catalog from the database. */
export type ReadWorkflowSettingsSource = () => Effect.Effect<
  WorkflowSettingsSource,
  HostOperationErrorAggregate
>;

/**
 * Settings that follow the task workflows and roles. A read adds the workflow defaults to a saved
 * config, and a write fails for a new key without an owner. A missing workspace stays missing.
 */
export const withTaskWorkflowSettings = (
  settingsConfig: SettingsConfigPort,
  readSource: ReadWorkflowSettingsSource,
): SettingsConfigPort => {
  const validate = <A>(use: () => A) =>
    Effect.try({
      try: use,
      catch: (cause) =>
        cause instanceof HostValidationError
          ? cause
          : new HostValidationError({ message: String(cause), cause }),
    });
  const readRepoValidated = (read: Effect.Effect<RepoConfig | null, SettingsConfigError>) =>
    Effect.gen(function* () {
      const workspace = yield* read;
      if (workspace === null) return null;
      const source = yield* readSource();
      return yield* validate(() => validateRepoTaskWorkflowSettings(workspace, source, "read"));
    });
  // A write reads the workflow owners first. Another host can publish a version meanwhile, so a
  // key of that version fails until the next save.
  const change =
    (
      source: WorkflowSettingsSource,
      edit: Parameters<SettingsConfigPort["updateConfig"]>[0],
    ): Parameters<SettingsConfigPort["updateConfig"]>[0] =>
    (current, catalog) =>
      applyTaskWorkflowSettings(
        edit(applyTaskWorkflowSettings(current, source, "read"), catalog),
        source,
        { saved: savedWorkflowSettingKeys(current) },
      );
  return {
    ...settingsConfig,
    readGlobalConfig: () =>
      Effect.gen(function* () {
        const config = yield* settingsConfig.readGlobalConfig();
        const source = yield* readSource();
        return yield* validate(() => applyGlobalTaskWorkflowSettings(config, source, "read"));
      }),
    readRepoConfig: (workspaceId) => readRepoValidated(settingsConfig.readRepoConfig(workspaceId)),
    readRepoConfigByRepoPath: (repoPath) =>
      readRepoValidated(settingsConfig.readRepoConfigByRepoPath(repoPath)),
    updateWorkspacePreferences: (workspaceId, edit) =>
      readSource().pipe(
        Effect.flatMap((source) =>
          settingsConfig.updateWorkspacePreferences(workspaceId, (current) => {
            const workspace = validateRepoTaskWorkflowSettings(current, source, "read");
            const next = edit(workspace);
            requireKnownActiveRole(workspace, next, source);
            return next;
          }),
        ),
      ),
    updateConfig: (edit, workspaceIds) =>
      readSource().pipe(
        Effect.flatMap((source) => settingsConfig.updateConfig(change(source, edit), workspaceIds)),
      ),
    applyConfigChange: (edit, workspaceIds) =>
      readSource().pipe(
        Effect.flatMap((source) =>
          settingsConfig.applyConfigChange(change(source, edit), workspaceIds),
        ),
      ),
    readConfig: (workspaceIds) =>
      Effect.gen(function* () {
        const config = yield* settingsConfig.readConfig(workspaceIds);
        const source = yield* readSource();
        return yield* validate(() => applyTaskWorkflowSettings(config, source, "read"));
      }),
  };
};
