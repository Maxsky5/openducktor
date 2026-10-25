import type { RunEventListener } from "@openducktor/frontend-core/connection/host-connection";
import { CONNECTION_RECONNECTED_EVENT_KIND } from "@openducktor/frontend-core/recovery/connection-control-events";

type RunEvent = Parameters<RunEventListener>[0];

/**
 * True when a run event can change the held outcomes of a workspace or the Autopilot failure of
 * the host: an outcome in the workspace, a failure change, or a reconnect after missed events. A
 * failure is for all workspaces of the host, so it has no workspace to match.
 */
export const changesHeldOutcomes = (payload: RunEvent, workspaceId: string): boolean => {
  if ("__openducktorConnectionControl" in payload) {
    return payload.kind === CONNECTION_RECONNECTED_EVENT_KIND && payload.missedEvents;
  }
  if (payload.type === "autopilot_failure") return true;
  return payload.type === "autopilot_outcome" && payload.outcome.workspaceId === workspaceId;
};
