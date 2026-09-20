import type { WorkspaceSessionExternalListInput } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { host } from "@/state/operations/host";
export const workspaceSessionExternalQueryOptions = (input: WorkspaceSessionExternalListInput) =>
  queryOptions({
    queryKey: [
      "workspace-session-external",
      input.workspaceId,
      input.runtimeKind,
      input.catalogRequestId,
      input.search,
      input.cursor ?? null,
      input.pageSize,
    ],
    queryFn: () => host.workspaceSessionExternalList(input),
    staleTime: Infinity,
    gcTime: 0,
  });
