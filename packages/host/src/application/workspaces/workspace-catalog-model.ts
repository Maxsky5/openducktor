import {
  type RepoConfig,
  type WorkspaceCatalog,
  type WorkspacePathResolution,
  type WorkspaceRecord,
  workspaceRecordSchema,
} from "@openducktor/contracts";
import { HostInvariantError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { LoadedGlobalConfig } from "../../config/global-config";

export const workspaceRecordForId = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
  workspaceId: string,
): WorkspaceRecord => {
  const repo = config.workspaces[workspaceId];
  if (!repo) {
    throw new HostInvariantError({
      invariant: "workspace_record_exists",
      message: "Workspace disappeared from config.",
    });
  }
  return workspaceRecordFromRepo(settingsConfig, config, workspaceId, repo);
};
const sortedWorkspaceIds = (config: LoadedGlobalConfig): string[] => {
  const orderedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const workspaceId of config.workspaceOrder) {
    if (config.workspaces[workspaceId] && !seenIds.has(workspaceId)) {
      seenIds.add(workspaceId);
      orderedIds.push(workspaceId);
    }
  }
  const remaining = Object.entries(config.workspaces).sort(
    ([leftId, leftRepo], [rightId, rightRepo]) => {
      const nameComparison = leftRepo.workspaceName.localeCompare(rightRepo.workspaceName);
      return nameComparison === 0 ? leftId.localeCompare(rightId) : nameComparison;
    },
  );
  for (const [workspaceId] of remaining) {
    if (!seenIds.has(workspaceId)) {
      seenIds.add(workspaceId);
      orderedIds.push(workspaceId);
    }
  }
  return orderedIds;
};
const workspaceRecordFromRepo = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
  workspaceId: string,
  repo: RepoConfig,
): WorkspaceRecord => {
  const defaultWorktreeBasePath = settingsConfig.defaultWorktreeBasePath(workspaceId);
  const effectiveWorktreeBasePath =
    repo.worktreeBasePath !== undefined
      ? settingsConfig.resolveConfiguredPath(repo.worktreeBasePath)
      : defaultWorktreeBasePath;
  return workspaceRecordSchema.parse({
    workspaceId: repo.workspaceId,
    workspaceName: repo.workspaceName,
    repoPath: repo.repoPath,
    iconDataUrl: null,
    isActive: config.activeWorkspace === workspaceId,
    hasConfig: true,
    configuredWorktreeBasePath: repo.worktreeBasePath ?? null,
    defaultWorktreeBasePath,
    effectiveWorktreeBasePath,
  });
};
export const workspaceRecordsInEffectiveOrder = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
): WorkspaceRecord[] =>
  sortedWorkspaceIds(config).map((workspaceId) => {
    const repo = config.workspaces[workspaceId];
    if (!repo) {
      throw new HostInvariantError({
        invariant: "workspace_order_matches_config",
        message: "Workspace disappeared from config.",
      });
    }
    return workspaceRecordFromRepo(settingsConfig, config, workspaceId, repo);
  });
const isClosedWorkspace = (config: LoadedGlobalConfig, workspaceId: string): boolean =>
  config.workspaces[workspaceId]?.closed === true;
const isIncompleteRemoval = (config: LoadedGlobalConfig, workspaceId: string): boolean =>
  config.workspaces[workspaceId]?.removal !== undefined;
const isBlockedWorkspace = (config: LoadedGlobalConfig, workspaceId: string): boolean =>
  isClosedWorkspace(config, workspaceId) || isIncompleteRemoval(config, workspaceId);
export const openWorkspaceRecordsInEffectiveOrder = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
): WorkspaceRecord[] =>
  workspaceRecordsInEffectiveOrder(settingsConfig, config).filter(
    (record) => !isBlockedWorkspace(config, record.workspaceId),
  );
export const buildWorkspaceCatalog = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
): WorkspaceCatalog => {
  const records = workspaceRecordsInEffectiveOrder(settingsConfig, config);
  return {
    openWorkspaces: records.filter((record) => !isBlockedWorkspace(config, record.workspaceId)),
    closedWorkspaces: records.filter(
      (record) =>
        isClosedWorkspace(config, record.workspaceId) &&
        !isIncompleteRemoval(config, record.workspaceId),
    ),
    incompleteRemovals: records.flatMap((workspace) => {
      const record = config.workspaces[workspace.workspaceId]?.removal;
      return record ? [{ workspace, record }] : [];
    }),
    onboardingCompleted: config.onboardingCompleted ?? Object.keys(config.workspaces).length > 0,
  };
};
export const firstOpenWorkspaceId = (
  config: LoadedGlobalConfig,
  excludedWorkspaceId?: string,
): string | undefined =>
  sortedWorkspaceIds(config).find(
    (workspaceId) =>
      workspaceId !== excludedWorkspaceId &&
      config.workspaces[workspaceId] &&
      !isBlockedWorkspace(config, workspaceId),
  );
export const workspacePathResolution = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
  repoConfig: RepoConfig,
): WorkspacePathResolution => {
  if (repoConfig.removal) {
    return {
      kind: "removing",
      removal: {
        workspace: workspaceRecordFromRepo(
          settingsConfig,
          config,
          repoConfig.workspaceId,
          repoConfig,
        ),
        record: repoConfig.removal,
      },
    };
  }
  return {
    kind: repoConfig.closed ? "closed" : "open",
    workspace: workspaceRecordFromRepo(settingsConfig, config, repoConfig.workspaceId, repoConfig),
  };
};
