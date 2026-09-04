import {
  globalConfigSchema,
  type RepoConfig,
  repoConfigSchema,
  workspaceAgentStudioStateSchema,
} from "@openducktor/contracts";
import type { LoadedGlobalConfig } from "../../config/global-config";
import { requireConfiguredWorkspace } from "./workspace-settings-model";

export const buildAgentStudioStateUpdate = (
  config: LoadedGlobalConfig,
  workspaceId: string,
  state: RepoConfig["agentStudioState"],
) => {
  const repoConfig = repoConfigSchema.parse({
    ...requireConfiguredWorkspace(config, workspaceId),
    agentStudioState: workspaceAgentStudioStateSchema.parse(state),
  });
  const nextConfig = globalConfigSchema.parse({
    ...config,
    workspaces: {
      ...config.workspaces,
      [workspaceId]: repoConfig,
    },
  });

  return { config: nextConfig, repoConfig };
};
