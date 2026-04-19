import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/query-client";
import { checksQueryKeys } from "@/state/queries/checks";
import { runtimeQueryKeys } from "@/state/queries/runtime";

const runtimeHealthQueryKeyPrefix = (repoPath: string) =>
  [...checksQueryKeys.all, "runtime-health", repoPath] as const;

export const invalidateRuntimeReadinessQueries = async ({
  repoPath,
  runtimeKind,
  queryClient = appQueryClient,
}: {
  repoPath: string;
  runtimeKind: RuntimeKind;
  queryClient?: Pick<QueryClient, "invalidateQueries">;
}): Promise<void> => {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: runtimeQueryKeys.list(runtimeKind, repoPath),
      exact: true,
    }),
    queryClient.invalidateQueries({
      queryKey: runtimeHealthQueryKeyPrefix(repoPath),
    }),
  ]);
};

export const ensureRuntimeAndInvalidateReadinessQueries = async ({
  repoPath,
  runtimeKind,
  ensureRuntime,
  queryClient = appQueryClient,
}: {
  repoPath: string;
  runtimeKind: RuntimeKind;
  ensureRuntime: (repoPath: string, runtimeKind: RuntimeKind) => Promise<RuntimeInstanceSummary>;
  queryClient?: Pick<QueryClient, "invalidateQueries">;
}): Promise<RuntimeInstanceSummary> => {
  const runtime = await ensureRuntime(repoPath, runtimeKind);
  await invalidateRuntimeReadinessQueries({
    repoPath,
    runtimeKind,
    queryClient,
  });
  return runtime;
};
