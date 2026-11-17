import { runtimeKindSchema } from "@openducktor/contracts";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { type RawRouteParams, routeParam } from "./route-params";

type RouteSessionIdentity =
  | { ok: true; identity: AgentSessionIdentity }
  | { ok: false; unknownRuntime?: string };

/** Reads the session fields shared by the session, tool call, and work routes. */
export function readRouteSessionIdentity(params: RawRouteParams): RouteSessionIdentity {
  const externalSessionId = routeParam(params.externalSessionId);
  const workingDirectory = routeParam(params.workingDirectory);
  const runtimeKindText = routeParam(params.runtimeKind);
  if (externalSessionId === null || workingDirectory === null || runtimeKindText === null) {
    return { ok: false };
  }
  const runtimeKind = runtimeKindSchema.safeParse(runtimeKindText);
  if (!runtimeKind.success) return { ok: false, unknownRuntime: runtimeKindText };
  return {
    ok: true,
    identity: { externalSessionId, runtimeKind: runtimeKind.data, workingDirectory },
  };
}
