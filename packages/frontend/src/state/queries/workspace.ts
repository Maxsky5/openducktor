import type { RepoConfig, SettingsSnapshot, WorkspaceRecord } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { normalizeTargetBranch } from "@/lib/target-branch";
import type { RepoSettingsInput } from "@/types/state-slices";
import { host } from "../operations/host";

type SettingsSnapshotQueryHost = Pick<typeof host, "workspaceGetSettingsSnapshot">;
type RepoConfigQueryHost = Pick<typeof host, "workspaceGetRepoConfig">;
type WorkspaceListQueryHost = Pick<typeof host, "workspaceList">;

const SETTINGS_SNAPSHOT_STALE_TIME_MS = 15 * 60_000;
const REPO_CONFIG_STALE_TIME_MS = 10 * 60_000;
const WORKSPACE_LIST_STALE_TIME_MS = 5 * 60_000;

export const workspaceQueryKeys = {
  all: ["workspace"] as const,
  settingsSnapshot: () => [...workspaceQueryKeys.all, "settings-snapshot"] as const,
  repoConfig: (workspaceId: string) =>
    [...workspaceQueryKeys.all, "repo-config", workspaceId] as const,
  list: () => [...workspaceQueryKeys.all, "list"] as const,
};

export const toRepoSettingsInput = (config: RepoConfig): RepoSettingsInput => ({
  defaultRuntimeKind: config.defaultRuntimeKind,
  worktreeBasePath: config.worktreeBasePath ?? "",
  branchPrefix: config.branchPrefix,
  defaultTargetBranch: normalizeTargetBranch(config.defaultTargetBranch),
  preStartHooks: config.hooks.preStart,
  postCompleteHooks: config.hooks.postComplete,
  devServers: config.devServers ?? [],
  worktreeFileCopies: config.worktreeFileCopies ?? [],
  agentDefaults: {
    spec: config.agentDefaults.spec
      ? {
          runtimeKind: config.agentDefaults.spec.runtimeKind,
          providerId: config.agentDefaults.spec.providerId,
          modelId: config.agentDefaults.spec.modelId,
          variant: config.agentDefaults.spec.variant ?? "",
          profileId: config.agentDefaults.spec.profileId ?? "",
        }
      : null,
    planner: config.agentDefaults.planner
      ? {
          runtimeKind: config.agentDefaults.planner.runtimeKind,
          providerId: config.agentDefaults.planner.providerId,
          modelId: config.agentDefaults.planner.modelId,
          variant: config.agentDefaults.planner.variant ?? "",
          profileId: config.agentDefaults.planner.profileId ?? "",
        }
      : null,
    build: config.agentDefaults.build
      ? {
          runtimeKind: config.agentDefaults.build.runtimeKind,
          providerId: config.agentDefaults.build.providerId,
          modelId: config.agentDefaults.build.modelId,
          variant: config.agentDefaults.build.variant ?? "",
          profileId: config.agentDefaults.build.profileId ?? "",
        }
      : null,
    qa: config.agentDefaults.qa
      ? {
          runtimeKind: config.agentDefaults.qa.runtimeKind,
          providerId: config.agentDefaults.qa.providerId,
          modelId: config.agentDefaults.qa.modelId,
          variant: config.agentDefaults.qa.variant ?? "",
          profileId: config.agentDefaults.qa.profileId ?? "",
        }
      : null,
  },
});

export const settingsSnapshotQueryOptions = (hostClient: SettingsSnapshotQueryHost = host) =>
  queryOptions({
    queryKey: workspaceQueryKeys.settingsSnapshot(),
    queryFn: () => hostClient.workspaceGetSettingsSnapshot(),
    staleTime: SETTINGS_SNAPSHOT_STALE_TIME_MS,
  });

export const repoConfigQueryOptions = (
  workspaceId: string,
  hostClient: RepoConfigQueryHost = host,
) =>
  queryOptions({
    queryKey: workspaceQueryKeys.repoConfig(workspaceId),
    queryFn: () => hostClient.workspaceGetRepoConfig(workspaceId),
    staleTime: REPO_CONFIG_STALE_TIME_MS,
  });

const workspaceListQueryOptions = (hostClient: WorkspaceListQueryHost = host) =>
  queryOptions({
    queryKey: workspaceQueryKeys.list(),
    queryFn: (): Promise<WorkspaceRecord[]> => hostClient.workspaceList(),
    staleTime: WORKSPACE_LIST_STALE_TIME_MS,
  });

export const loadSettingsSnapshotFromQuery = (
  queryClient: QueryClient,
  hostClient?: SettingsSnapshotQueryHost,
): Promise<SettingsSnapshot> =>
  queryClient.ensureQueryData(settingsSnapshotQueryOptions(hostClient));

export const loadRepoConfigFromQuery = (
  queryClient: QueryClient,
  workspaceId: string,
  hostClient?: RepoConfigQueryHost,
): Promise<RepoConfig> =>
  queryClient.ensureQueryData(repoConfigQueryOptions(workspaceId, hostClient));

export const loadWorkspaceListFromQuery = (
  queryClient: QueryClient,
  hostClient?: WorkspaceListQueryHost,
): Promise<WorkspaceRecord[]> => queryClient.fetchQuery(workspaceListQueryOptions(hostClient));
