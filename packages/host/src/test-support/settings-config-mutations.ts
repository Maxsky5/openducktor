import { Effect } from "effect";
import { HostValidationError } from "../effect/host-errors";
import type { SettingsConfigChange, SettingsConfigPort } from "../ports/settings-config-port";
import { composeGlobalConfig, toHostPreferences } from "../config/global-config";
import { hostPreferencesSchema } from "../config/global-config";
import { repoConfigSchema } from "@openducktor/contracts";

type DerivedSettingsMethods = Pick<
  SettingsConfigPort,
  | "readGlobalConfig"
  | "readAutopilotSettings"
  | "readRepoConfig"
  | "readRepoConfigByRepoPath"
  | "readWorkspaceCatalogSnapshot"
  | "applyConfigChange"
  | "updatePreferences"
  | "updateWorkspacePreferences"
>;
type TestSettingsPort = Omit<SettingsConfigPort, keyof DerivedSettingsMethods>;

export const withSettingsConfigMutationTestMethods = <Port extends TestSettingsPort>(
  port: Port,
): NoInfer<Port> & DerivedSettingsMethods => ({
  readGlobalConfig: () =>
    port.readConfig().pipe(Effect.map(({ workspaces: _workspaces, ...global }) => global)),
  readAutopilotSettings: () => port.readConfig().pipe(Effect.map((config) => config.autopilot)),
  readRepoConfig: (workspaceId) =>
    port.readConfig().pipe(Effect.map((config) => config.workspaces[workspaceId] ?? null)),
  readRepoConfigByRepoPath: (repoPath) =>
    port.readConfig().pipe(
      Effect.flatMap((config) => {
        const matches = Object.values(config.workspaces).filter(
          (workspace) => workspace.repoPath === repoPath,
        );
        return matches.length > 1
          ? Effect.fail(
              new HostValidationError({
                field: "repoPath",
                message: `More than one workspace uses repository path ${repoPath}. Use a workspace ID.`,
              }),
            )
          : Effect.succeed(matches[0] ?? null);
      }),
    ),
  readWorkspaceCatalogSnapshot: () =>
    port.readConfig().pipe(
      Effect.map((config) => ({
        catalogRevision: 0,
        workspaces: Object.values(config.workspaces).map((workspace) => ({
          workspaceId: workspace.workspaceId,
          workspaceName: workspace.workspaceName,
          abbreviation: workspace.abbreviation,
          tileColor: workspace.tileColor,
          repoPath: workspace.repoPath,
          worktreeBasePath: workspace.worktreeBasePath,
          closed: workspace.closed,
          removal: workspace.removal,
        })),
        workspaceOrder: config.workspaceOrder,
        activeWorkspace: config.activeWorkspace,
      })),
    ),
  applyConfigChange: (change: SettingsConfigChange, workspaceIds) =>
    port.updateConfig(change, workspaceIds).pipe(
      Effect.map((config) => ({
        shared: "saved" as const,
        preferences: "saved" as const,
        config,
      })),
    ),
  updatePreferences: (change) =>
    port
      .updateConfig((current) =>
        composeGlobalConfig(
          current,
          hostPreferencesSchema.parse(change(toHostPreferences(current))),
        ),
      )
      .pipe(Effect.map(toHostPreferences)),
  updateWorkspacePreferences: (workspaceId, change) =>
    port
      .updateConfig((current) => {
        const workspace = current.workspaces[workspaceId];
        if (!workspace)
          throw new HostValidationError({
            field: "workspaceId",
            message: `Workspace not found in config: ${workspaceId}. Add/select the workspace before updating configuration.`,
          });
        const next = repoConfigSchema.parse({ ...workspace, agentStudioState: change(workspace) });
        return { ...current, workspaces: { ...current.workspaces, [workspaceId]: next } };
      })
      .pipe(Effect.map((config) => repoConfigSchema.parse(config.workspaces[workspaceId]))),
  ...port,
});
