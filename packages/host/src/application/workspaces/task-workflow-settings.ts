import { Effect } from "effect";
import { applyTaskWorkflowSettings } from "../../config/workflow-settings";
import { HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";

/**
 * Settings that follow the task workflows. A read adds the workflow defaults to a saved config, and
 * a write fails for a key outside the workflows. A missing config stays missing.
 */
export const withTaskWorkflowSettings = (
  settingsConfig: SettingsConfigPort,
  taskWorkflows: TaskWorkflowResolver,
): SettingsConfigPort => {
  const apply = (config: Parameters<SettingsConfigPort["writeConfig"]>[0]) =>
    Effect.try({
      try: () => applyTaskWorkflowSettings(config, taskWorkflows),
      catch: (cause) =>
        cause instanceof HostValidationError
          ? cause
          : new HostValidationError({ message: String(cause), cause }),
    });
  return {
    ...settingsConfig,
    readConfig: (options) =>
      settingsConfig
        .readConfig(options)
        .pipe(Effect.flatMap((config) => (config === null ? Effect.succeed(null) : apply(config)))),
    writeConfig: (config) => apply(config).pipe(Effect.flatMap(settingsConfig.writeConfig)),
  };
};
