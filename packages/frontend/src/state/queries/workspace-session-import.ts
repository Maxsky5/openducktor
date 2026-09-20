import type { WorkspaceSessionExternalListInput } from "@openducktor/contracts";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { host } from "@/state/operations/host";
export const workspaceSessionExternalQueryOptions = (
  input: WorkspaceSessionExternalListInput | null,
) =>
  queryOptions({
    queryKey: input
      ? [
          "workspace-session-external",
          input.workspaceId,
          input.runtimeKind,
          input.catalogRequestId,
          input.search,
          input.cursor ?? null,
          input.pageSize,
        ]
      : ["workspace-session-external", "skipped"],
    queryFn: input ? () => host.workspaceSessionExternalList(input) : skipToken,
    staleTime: Infinity,
    gcTime: 0,
  });
