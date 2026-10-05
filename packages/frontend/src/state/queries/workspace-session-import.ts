import type { RuntimeKind, WorkspaceSessionExternalListInput } from "@openducktor/contracts";
import { type QueryKey, queryOptions, skipToken } from "@tanstack/react-query";
import { host } from "@/state/operations/host";

export const workspaceSessionExternalQueryKeys = {
  all: ["workspace-session-external"] as const,
  /** True for an import discovery key of this runtime kind in any workspace. */
  matchesRuntimeKind: (key: QueryKey, runtimeKind: RuntimeKind): boolean =>
    key[0] === workspaceSessionExternalQueryKeys.all[0] && key[2] === runtimeKind,
};

export const workspaceSessionExternalQueryOptions = (
  input: WorkspaceSessionExternalListInput | null,
) =>
  queryOptions({
    queryKey: input
      ? [
          ...workspaceSessionExternalQueryKeys.all,
          input.workspaceId,
          input.runtimeKind,
          input.catalogRequestId,
          input.search,
          input.cursor ?? null,
          input.pageSize,
        ]
      : [...workspaceSessionExternalQueryKeys.all, "skipped"],
    queryFn: input ? () => host.workspaceSessionExternalList(input) : skipToken,
    staleTime: Infinity,
    gcTime: 0,
  });
