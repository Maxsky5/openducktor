import type { WorkspaceSessionLaunchRead } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";
import { host } from "../operations/shared/host";

export const workspaceSessionLaunchQueryOptions = (input: WorkspaceSessionLaunchRead) =>
  queryOptions({
    queryKey: [
      "workspace-session-launches",
      input.workspaceId,
      input.repoPath,
      input.sessionId,
      input.launchAttemptId ?? null,
    ] as const,
    queryFn: () => host.workspaceSessionLaunchRead(input),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
