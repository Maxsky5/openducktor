import type { RepoConfig } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  applyGlobalTaskWorkflowSettings,
  applyTaskWorkflowSettings,
  validateRepoTaskWorkflowSettings,
} from "../../config/workflow-settings";
import { HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";
import type { TaskWorkflowResolver } from "../../ports/task-workflow-port";

/**
 * Settings that follow the task workflows. A read adds the workflow defaults to a saved config, and
 * a write fails for a key outside the workflows. A missing workspace stays missing.
 */
export const withTaskWorkflowSettings = (
  settingsConfig: SettingsConfigPort,
  taskWorkflows: TaskWorkflowResolver,
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
    read.pipe(
      Effect.flatMap((workspace) =>
        workspace === null
          ? Effect.succeed(null)
          : validate(() => validateRepoTaskWorkflowSettings(workspace, taskWorkflows)),
      ),
    );
  return {
    ...settingsConfig,
    readGlobalConfig: () =>
      settingsConfig
        .readGlobalConfig()
        .pipe(
          Effect.flatMap((config) =>
            validate(() => applyGlobalTaskWorkflowSettings(config, taskWorkflows)),
          ),
        ),
    readRepoConfig: (workspaceId) => readRepoValidated(settingsConfig.readRepoConfig(workspaceId)),
    readRepoConfigByRepoPath: (repoPath) =>
      readRepoValidated(settingsConfig.readRepoConfigByRepoPath(repoPath)),
    updateWorkspacePreferences: (workspaceId, change) =>
      settingsConfig.updateWorkspacePreferences(workspaceId, (current) => {
        const workspace = validateRepoTaskWorkflowSettings(current, taskWorkflows);
        return validateRepoTaskWorkflowSettings(
          {
            ...workspace,
            agentStudioState: change(workspace),
          },
          taskWorkflows,
        ).agentStudioState;
      }),
    updateConfig: (change, workspaceIds) =>
      settingsConfig.updateConfig(
        (current, catalog) =>
          applyTaskWorkflowSettings(
            change(applyTaskWorkflowSettings(current, taskWorkflows), catalog),
            taskWorkflows,
          ),
        workspaceIds,
      ),
    applyConfigChange: (change, workspaceIds) =>
      settingsConfig.applyConfigChange(
        (current, catalog) =>
          applyTaskWorkflowSettings(
            change(applyTaskWorkflowSettings(current, taskWorkflows), catalog),
            taskWorkflows,
          ),
        workspaceIds,
      ),
    readConfig: (workspaceIds) =>
      settingsConfig
        .readConfig(workspaceIds)
        .pipe(
          Effect.flatMap((config) =>
            validate(() => applyTaskWorkflowSettings(config, taskWorkflows)),
          ),
        ),
  };
};
