import type { RepoConfig, SettingsSnapshot, WorkspaceRecord } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { hostClient as host } from "@/lib/host-client";
import { normalizeTargetBranch } from "@/lib/target-branch";
import { DEFAULT_RUNTIME_KIND } from "@/state/agent-runtime-registry";
import type { RepoSettingsInput } from "@/types/state-slices";

const SETTINGS_SNAPSHOT_STALE_TIME_MS = 15 * 60_000;
const REPO_CONFIG_STALE_TIME_MS = 10 * 60_000;
const WORKSPACE_LIST_STALE_TIME_MS = 5 * 60_000;

export const workspaceQueryKeys = {
  all: ["workspace"] as const,
  settingsSnapshot: () => [...workspaceQueryKeys.all, "settings-snapshot"] as const,
  repoConfig: (repoPath: string) => [...workspaceQueryKeys.all, "repo-config", repoPath] as const,
  list: () => [...workspaceQueryKeys.all, "list"] as const,
};

export const toRepoSettingsInput = (config: RepoConfig): RepoSettingsInput => ({
  defaultRuntimeKind: config.defaultRuntimeKind,
  worktreeBasePath: config.worktreeBasePath ?? "",
  branchPrefix: config.branchPrefix,
  defaultTargetBranch: normalizeTargetBranch(config.defaultTargetBranch),
  trustedHooks: config.trustedHooks,
  preStartHooks: config.hooks.preStart,
  postCompleteHooks: config.hooks.postComplete,
  worktreeFileCopies: config.worktreeFileCopies ?? [],
  agentDefaults: {
    spec: config.agentDefaults.spec
      ? {
          runtimeKind: config.agentDefaults.spec.runtimeKind ?? DEFAULT_RUNTIME_KIND,
          providerId: config.agentDefaults.spec.providerId,
          modelId: config.agentDefaults.spec.modelId,
          variant: config.agentDefaults.spec.variant ?? "",
          profileId: config.agentDefaults.spec.profileId ?? "",
        }
      : null,
    planner: config.agentDefaults.planner
      ? {
          runtimeKind: config.agentDefaults.planner.runtimeKind ?? DEFAULT_RUNTIME_KIND,
          providerId: config.agentDefaults.planner.providerId,
          modelId: config.agentDefaults.planner.modelId,
          variant: config.agentDefaults.planner.variant ?? "",
          profileId: config.agentDefaults.planner.profileId ?? "",
        }
      : null,
    build: config.agentDefaults.build
      ? {
          runtimeKind: config.agentDefaults.build.runtimeKind ?? DEFAULT_RUNTIME_KIND,
          providerId: config.agentDefaults.build.providerId,
          modelId: config.agentDefaults.build.modelId,
          variant: config.agentDefaults.build.variant ?? "",
          profileId: config.agentDefaults.build.profileId ?? "",
        }
      : null,
    qa: config.agentDefaults.qa
      ? {
          runtimeKind: config.agentDefaults.qa.runtimeKind ?? DEFAULT_RUNTIME_KIND,
          providerId: config.agentDefaults.qa.providerId,
          modelId: config.agentDefaults.qa.modelId,
          variant: config.agentDefaults.qa.variant ?? "",
          profileId: config.agentDefaults.qa.profileId ?? "",
        }
      : null,
  },
});

export const settingsSnapshotQueryOptions = () =>
  queryOptions({
    queryKey: workspaceQueryKeys.settingsSnapshot(),
    queryFn: () => host.workspaceGetSettingsSnapshot(),
    staleTime: SETTINGS_SNAPSHOT_STALE_TIME_MS,
  });

export const repoConfigQueryOptions = (repoPath: string) =>
  queryOptions({
    queryKey: workspaceQueryKeys.repoConfig(repoPath),
    queryFn: () => host.workspaceGetRepoConfig(repoPath),
    staleTime: REPO_CONFIG_STALE_TIME_MS,
  });

const workspaceListQueryOptions = () =>
  queryOptions({
    queryKey: workspaceQueryKeys.list(),
    queryFn: (): Promise<WorkspaceRecord[]> => host.workspaceList(),
    staleTime: WORKSPACE_LIST_STALE_TIME_MS,
  });

export const loadSettingsSnapshotFromQuery = (
  queryClient: QueryClient,
): Promise<SettingsSnapshot> => queryClient.ensureQueryData(settingsSnapshotQueryOptions());

export const loadRepoConfigFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
): Promise<RepoConfig> => queryClient.ensureQueryData(repoConfigQueryOptions(repoPath));

export const loadWorkspaceListFromQuery = (queryClient: QueryClient): Promise<WorkspaceRecord[]> =>
  queryClient.fetchQuery(workspaceListQueryOptions());
