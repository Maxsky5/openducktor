import {
  type AgentModelDefault,
  type ChatSettings,
  chatSettingsSchema,
  type RepoConfig,
  type SettingsSnapshot,
  type WorkspaceCatalog,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import { type QueryClient, type QueryFilters, queryOptions } from "@tanstack/react-query";
import { normalizeTargetBranch } from "../lib/target-branch";
import type { RepoAgentDefaultInput, RepoSettingsInput } from "../types/session-slices";
import { connectionHost } from "../connection/client-connection";
import { runtimeCatalogQueryKeys } from "./runtime-catalog";

type WorkspaceRecordUpdate =
  | WorkspaceRecord[]
  | ((current: WorkspaceRecord[] | undefined) => WorkspaceRecord[]);

const SETTINGS_SNAPSHOT_STALE_TIME_MS = 15 * 60_000;
const REPO_CONFIG_STALE_TIME_MS = 10 * 60_000;
const WORKSPACE_LIST_STALE_TIME_MS = 5 * 60_000;

export const workspaceQueryKeys = {
  all: ["workspace"] as const,
  settingsSnapshot: () => [...workspaceQueryKeys.all, "settings-snapshot"] as const,
  repoConfig: (workspaceId: string) =>
    [...workspaceQueryKeys.all, "repo-config", workspaceId] as const,
  list: () => [...workspaceQueryKeys.all, "list"] as const,
  catalog: () => [...workspaceQueryKeys.all, "catalog"] as const,
};

const toRepoAgentDefaultInput = (
  value: AgentModelDefault | undefined,
): RepoAgentDefaultInput | null =>
  value
    ? {
        runtimeKind: value.runtimeKind,
        providerId: value.providerId,
        modelId: value.modelId,
        variant: value.variant ?? "",
        profileId: value.profileId ?? "",
      }
    : null;

export const toRepoSettingsInput = (config: RepoConfig): RepoSettingsInput => ({
  defaultModel: toRepoAgentDefaultInput(config.defaultModel),
  worktreeBasePath: config.worktreeBasePath ?? "",
  branchPrefix: config.branchPrefix,
  defaultTargetBranch: normalizeTargetBranch(config.defaultTargetBranch),
  postCompleteHooks: config.hooks.postComplete,
  actions: config.actions,
  worktreeCopyPaths: config.worktreeCopyPaths ?? [],
  agentDefaults: {
    spec: toRepoAgentDefaultInput(config.agentDefaults.spec),
    planner: toRepoAgentDefaultInput(config.agentDefaults.planner),
    build: toRepoAgentDefaultInput(config.agentDefaults.build),
    qa: toRepoAgentDefaultInput(config.agentDefaults.qa),
  },
});

export const settingsSnapshotQueryOptions = () =>
  queryOptions({
    queryKey: workspaceQueryKeys.settingsSnapshot(),
    queryFn: ({ client }) => connectionHost(client).workspaceGetSettingsSnapshot(),
    staleTime: SETTINGS_SNAPSHOT_STALE_TIME_MS,
  });

export const readChatSettingsFromSnapshot = (snapshot: SettingsSnapshot): ChatSettings =>
  chatSettingsSchema.parse(snapshot.chat);

export const repoConfigQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: workspaceQueryKeys.repoConfig(workspaceId),
    queryFn: ({ client }) => connectionHost(client).workspaceGetRepoConfig(workspaceId),
    staleTime: REPO_CONFIG_STALE_TIME_MS,
    gcTime: Number.POSITIVE_INFINITY,
  });

export const workspaceListQueryOptions = () =>
  queryOptions({
    queryKey: workspaceQueryKeys.list(),
    queryFn: ({ client }): Promise<WorkspaceRecord[]> => connectionHost(client).workspaceList(),
    staleTime: WORKSPACE_LIST_STALE_TIME_MS,
  });

export const workspaceCatalogQueryOptions = () =>
  queryOptions({
    queryKey: workspaceQueryKeys.catalog(),
    queryFn: ({ client }): Promise<WorkspaceCatalog> =>
      connectionHost(client).workspaceCatalogGet(),
    staleTime: WORKSPACE_LIST_STALE_TIME_MS,
  });

export const loadSettingsSnapshotFromQuery = (
  queryClient: QueryClient,
): Promise<SettingsSnapshot> => queryClient.ensureQueryData(settingsSnapshotQueryOptions());

export const loadRepoConfigFromQuery = (
  queryClient: QueryClient,
  workspaceId: string,
): Promise<RepoConfig> => queryClient.ensureQueryData(repoConfigQueryOptions(workspaceId));

export const loadWorkspaceListFromQuery = (queryClient: QueryClient): Promise<WorkspaceRecord[]> =>
  queryClient.fetchQuery(workspaceListQueryOptions());

export const writeWorkspaceListToQuery = (
  queryClient: QueryClient,
  recordsOrUpdater: WorkspaceRecordUpdate,
): void => {
  void queryClient.cancelQueries(
    {
      queryKey: workspaceQueryKeys.list(),
      exact: true,
    },
    { revert: false },
  );
  queryClient.setQueryData<WorkspaceRecord[]>(workspaceQueryKeys.list(), recordsOrUpdater);
};

export const writeWorkspaceCatalogToQuery = (
  queryClient: QueryClient,
  catalog: WorkspaceCatalog,
): void => {
  void queryClient.cancelQueries(
    {
      queryKey: workspaceQueryKeys.catalog(),
      exact: true,
    },
    { revert: false },
  );
  queryClient.setQueryData<WorkspaceCatalog>(workspaceQueryKeys.catalog(), catalog);
};

export const invalidateWorkspaceSettingsSnapshot = async (
  queryClient: QueryClient,
): Promise<void> => {
  await queryClient.invalidateQueries({
    queryKey: workspaceQueryKeys.settingsSnapshot(),
    exact: true,
  });
  queryClient.removeQueries({
    queryKey: workspaceQueryKeys.settingsSnapshot(),
    exact: true,
    type: "inactive",
  });
};

export const invalidateWorkspaceCaches = async (queryClient: QueryClient): Promise<void> => {
  await queryClient.invalidateQueries({
    queryKey: workspaceQueryKeys.list(),
  });
  await queryClient.invalidateQueries({
    queryKey: workspaceQueryKeys.catalog(),
  });
  await invalidateWorkspaceSettingsSnapshot(queryClient);
};

const queryKeyHasIdentity = (queryKey: readonly unknown[], identity: string): boolean =>
  JSON.stringify(queryKey).includes(JSON.stringify(identity));

const sharedWorkspaceQueryKeys = new Set([
  JSON.stringify(workspaceQueryKeys.list()),
  JSON.stringify(workspaceQueryKeys.catalog()),
]);

export const dropWorkspaceConfigurationQueries = (
  queryClient: QueryClient,
  identity: { repoPath: string; workspaceId: string },
): void => {
  const filters: QueryFilters[] = [
    { queryKey: runtimeCatalogQueryKeys.repoCatalogScope(identity.repoPath) },
    { queryKey: workspaceQueryKeys.repoConfig(identity.workspaceId), exact: true },
  ];
  for (const filter of filters) {
    void queryClient.cancelQueries(filter, { revert: false });
    queryClient.removeQueries(filter);
  }
};

export const dropWorkspaceQueries = (
  queryClient: QueryClient,
  identity: { repoPath: string; workspaceId: string },
): void => {
  dropWorkspaceConfigurationQueries(queryClient, identity);
  const matchesRemovedWorkspace = (query: { queryKey: readonly unknown[] }): boolean => {
    const serializedKey = JSON.stringify(query.queryKey);
    if (sharedWorkspaceQueryKeys.has(serializedKey)) {
      return false;
    }

    return (
      queryKeyHasIdentity(query.queryKey, identity.workspaceId) ||
      queryKeyHasIdentity(query.queryKey, identity.repoPath)
    );
  };
  void queryClient.cancelQueries({ predicate: matchesRemovedWorkspace }, { revert: false });
  queryClient.removeQueries({ predicate: matchesRemovedWorkspace });
};
