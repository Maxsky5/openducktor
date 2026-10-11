import { queryOptions } from "@tanstack/react-query";
import { host } from "../operations/host";

export const autopilotQueryKeys = {
  all: ["autopilot"] as const,
  state: (workspaceId: string) => [...autopilotQueryKeys.all, "state", workspaceId] as const,
  settings: () => [...autopilotQueryKeys.all, "settings"] as const,
};

/** Live run events change the held outcomes, so each read asks the host again. */
export const autopilotStateQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: autopilotQueryKeys.state(workspaceId),
    queryFn: () => host.autopilotStateRead({ workspaceId }),
    staleTime: 0,
    gcTime: 0,
  });

/**
 * The saved Autopilot rules, apart from the settings snapshot. No settings mutation writes or
 * cancels this entry. The `autopilot_settings_saved` event and a reconnect after missed events
 * invalidate it.
 */
export const autopilotSettingsQueryOptions = () =>
  queryOptions({
    queryKey: autopilotQueryKeys.settings(),
    queryFn: async () => (await host.workspaceGetSettingsSnapshot()).autopilot,
    staleTime: Number.POSITIVE_INFINITY,
  });
