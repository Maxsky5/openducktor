import {
  type AgentModelDefault,
  type ChatSettings,
  chatSettingsSchema,
  type RepoConfig,
  type SettingsSnapshot,
  type WorkspaceCatalog,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { normalizeTargetBranch } from "@/lib/target-branch";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { RepoAgentDefaultInput, RepoSettingsInput } from "@/types/state-slices";
import { host } from "../operations/host";

type SettingsSnapshotQueryHost = Pick<typeof host, "workspaceGetSettingsSnapshot">;
type RepoConfigQueryHost = Pick<typeof host, "workspaceGetRepoConfig">;
type WorkspaceCatalogQueryHost = Pick<typeof host, "workspaceCatalogGet">;
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
  preStartHooks: config.hooks.preStart,
  postCompleteHooks: config.hooks.postComplete,
  devServers: config.devServers ?? [],
  worktreeCopyPaths: config.worktreeCopyPaths ?? [],
  agentDefaults: {
    spec: toRepoAgentDefaultInput(config.agentDefaults.spec),
    planner: toRepoAgentDefaultInput(config.agentDefaults.planner),
    build: toRepoAgentDefaultInput(config.agentDefaults.build),
    qa: toRepoAgentDefaultInput(config.agentDefaults.qa),
  },
});

export const settingsSnapshotQueryOptions = (hostClient: SettingsSnapshotQueryHost = host) =>
  queryOptions({
    queryKey: workspaceQueryKeys.settingsSnapshot(),
    queryFn: () => hostClient.workspaceGetSettingsSnapshot(),
    staleTime: SETTINGS_SNAPSHOT_STALE_TIME_MS,
  });

export const readChatSettingsFromSnapshot = (snapshot: SettingsSnapshot): ChatSettings =>
  chatSettingsSchema.parse(snapshot.chat);

export const repoConfigQueryOptions = (
  workspaceId: string,
  hostClient: RepoConfigQueryHost = host,
) =>
  queryOptions({
    queryKey: workspaceQueryKeys.repoConfig(workspaceId),
    queryFn: () => hostClient.workspaceGetRepoConfig(workspaceId),
    staleTime: REPO_CONFIG_STALE_TIME_MS,
  });

export const workspaceCatalogQueryOptions = (hostClient: WorkspaceCatalogQueryHost = host) =>
  queryOptions({
    queryKey: workspaceQueryKeys.catalog(),
    queryFn: (): Promise<WorkspaceCatalog> => hostClient.workspaceCatalogGet(),
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

export const loadWorkspaceCatalogFromQuery = (
  queryClient: QueryClient,
  hostClient?: WorkspaceCatalogQueryHost,
): Promise<WorkspaceCatalog> =>
  queryClient.fetchQuery({
    ...workspaceCatalogQueryOptions(hostClient),
    staleTime: 0,
  });

export const updateWorkspaceCatalogOpenWorkspaces = (
  queryClient: QueryClient,
  recordsOrUpdater: WorkspaceRecordUpdate,
): void => {
  void queryClient.cancelQueries(
    {
      queryKey: workspaceQueryKeys.catalog(),
      exact: true,
    },
    { revert: false },
  );
  queryClient.setQueryData<WorkspaceCatalog>(workspaceQueryKeys.catalog(), (current) => {
    if (!current) return current;
    const openWorkspaces = Array.isArray(recordsOrUpdater)
      ? recordsOrUpdater
      : recordsOrUpdater(current.openWorkspaces);
    return { ...current, openWorkspaces };
  });
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

export const markWorkspaceCachesChanged = async (
  queryClient: QueryClient,
  options: { throwOnError?: boolean } = {},
): Promise<void> => {
  const invalidateOptions = { throwOnError: options.throwOnError ?? false };
  const invalidations = await Promise.allSettled([
    queryClient.invalidateQueries(
      {
        queryKey: workspaceQueryKeys.catalog(),
      },
      invalidateOptions,
    ),
    queryClient.invalidateQueries(
      {
        queryKey: workspaceQueryKeys.settingsSnapshot(),
        exact: true,
      },
      invalidateOptions,
    ),
  ]);
  queryClient.removeQueries({
    queryKey: workspaceQueryKeys.settingsSnapshot(),
    exact: true,
    type: "inactive",
  });
  const failure = invalidations.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
};

const workspaceConfigQueryKeyMatches = (
  queryKey: readonly unknown[],
  workspaceId: string,
): boolean =>
  queryKey[0] === "workspace" && queryKey[1] === "repo-config" && queryKey[2] === workspaceId;

const workspaceSessionQueryKeyMatches = (
  queryKey: readonly unknown[],
  workspaceId: string,
): boolean =>
  (queryKey[0] === "workspace-sessions" || queryKey[0] === "workspace-session-archive-preview") &&
  queryKey[1] === workspaceId;

const repoScopedQueryKeyMatches = (queryKey: readonly unknown[], repoPath: string): boolean => {
  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);
  return queryKey.some(
    (segment, index) => index >= 1 && (segment === repoPath || segment === normalizedRepoPath),
  );
};

export const dropWorkspaceQueries = async (
  queryClient: QueryClient,
  identity: { repoPath: string; workspaceId: string },
): Promise<void> => {
  const matchesRemovedWorkspace = (query: { queryKey: readonly unknown[] }): boolean =>
    workspaceConfigQueryKeyMatches(query.queryKey, identity.workspaceId) ||
    workspaceSessionQueryKeyMatches(query.queryKey, identity.workspaceId) ||
    repoScopedQueryKeyMatches(query.queryKey, identity.repoPath);
  await queryClient.cancelQueries({ predicate: matchesRemovedWorkspace }, { revert: false });
  queryClient.removeQueries({ predicate: matchesRemovedWorkspace });
};
