import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type GitProviderConfig,
  type GitProviderHealth,
} from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { scheduleTask, type ScheduleTask } from "@/lib/scheduling";
import { host } from "@/state/operations/host";
import { withDiagnosticsQueryTimeout } from "./checks";

type GitProviderHealthHost = Pick<typeof host, "workspaceGetGitProviderHealth">;

const GIT_PROVIDER_HEALTH_STALE_TIME_MS = 30_000;

export const gitProviderHealthQueryKeys = {
  all: ["git-provider-health"] as const,
  repo: (repoPath: string) => [...gitProviderHealthQueryKeys.all, repoPath] as const,
};

export const gitProviderHealthQueryOptions = (
  repoPath: string,
  hostClient: GitProviderHealthHost = host,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: gitProviderHealthQueryKeys.repo(repoPath),
    queryFn: (): Promise<GitProviderHealth> =>
      withDiagnosticsQueryTimeout(hostClient.workspaceGetGitProviderHealth(repoPath), scheduler),
    staleTime: GIT_PROVIDER_HEALTH_STALE_TIME_MS,
  });

export const shouldLoadGitProviderHealth = ({
  isGitSection,
  provider,
  repoPath,
}: {
  isGitSection: boolean;
  provider: GitProviderConfig | undefined;
  repoPath: string;
}): boolean =>
  isGitSection &&
  provider?.id === GITHUB_PROVIDER_DESCRIPTOR.id &&
  provider.enabled === true &&
  repoPath.length > 0;
