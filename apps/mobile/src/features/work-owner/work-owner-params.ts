import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { sessionParams, type WorkOwnerParams } from "@/navigation/routes";
import { type RawRouteParams, routeParam } from "@/navigation/route-params";
import { readRouteSessionIdentity } from "@/navigation/session-route-params";

/** The owner of a work view, read from its route. */
export type WorkOwnerRef =
  | { readonly kind: "task"; readonly workspaceId: string; readonly taskId: string }
  | Readonly<AgentSessionIdentity & { kind: "chat"; workspaceId: string }>;

/**
 * Reads the work owner from route params. A task route has `taskId`. A chat route has the
 * runtime session identity. Returns null when the params name neither, or name a runtime that
 * this app does not know.
 */
export const readWorkOwnerRef = (raw: RawRouteParams): WorkOwnerRef | null => {
  const workspaceId = routeParam(raw["workspaceId"]);
  if (workspaceId === null) return null;
  const taskId = routeParam(raw["taskId"]);
  if (taskId !== null) return { kind: "task", workspaceId, taskId };
  const session = readRouteSessionIdentity(raw);
  return session.ok ? { kind: "chat", workspaceId, ...session.identity } : null;
};

/** The route params of the owner, for the `routes` builders. */
export const toWorkOwnerParams = (owner: WorkOwnerRef): WorkOwnerParams =>
  owner.kind === "task"
    ? { workspaceId: owner.workspaceId, taskId: owner.taskId }
    : sessionParams(owner.workspaceId, owner);

/** A stable key of the owner, for caches and view state. */
export const workOwnerRefKey = (owner: WorkOwnerRef): string =>
  owner.kind === "task"
    ? JSON.stringify(["task", owner.workspaceId, owner.taskId])
    : JSON.stringify([
        "chat",
        owner.workspaceId,
        owner.runtimeKind,
        owner.externalSessionId,
        owner.workingDirectory,
      ]);
