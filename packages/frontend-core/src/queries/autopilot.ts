import { queryOptions } from "@tanstack/react-query";
import { connectionHost } from "../connection/client-connection";

export const autopilotQueryKeys = {
  all: ["autopilot"] as const,
  state: (workspaceId: string) => [...autopilotQueryKeys.all, "state", workspaceId] as const,
};

/** Live run events change the held outcomes, so each read asks the host again. */
export const autopilotStateQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: autopilotQueryKeys.state(workspaceId),
    queryFn: ({ client }) => connectionHost(client).autopilotStateRead({ workspaceId }),
    staleTime: 0,
    gcTime: 0,
  });
