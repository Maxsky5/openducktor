import { queryOptions } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";

export const workspaceSessionArchivePreviewQueryOptions = (
  workspaceId: string,
  sessionId: string,
) =>
  queryOptions({
    queryKey: ["workspace-session-archive-preview", workspaceId, sessionId] as const,
    queryFn: ({ client }) =>
      connectionHost(client).workspaceSessionArchivePreview({ workspaceId, sessionId }),
    staleTime: 0,
    retry: false,
  });
