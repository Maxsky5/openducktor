import { type RuntimeKind, runtimeKindSchema } from "@openducktor/contracts";
import type { WorkOwnerParams } from "@/navigation/routes";
import { type RawRouteParams, routeParam } from "@/navigation/route-params";

/** The search params of a route, as Expo Router gives them. */

/** The owner of a work view, read from its route. */
export type WorkOwnerRef =
  | { readonly kind: "task"; readonly workspaceId: string; readonly taskId: string }
  | {
      readonly kind: "chat";
      readonly workspaceId: string;
      readonly externalSessionId: string;
      readonly runtimeKind: RuntimeKind;
      readonly workingDirectory: string;
    };

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
  const externalSessionId = routeParam(raw["externalSessionId"]);
  const runtimeKind = runtimeKindSchema.safeParse(routeParam(raw["runtimeKind"]));
  const workingDirectory = routeParam(raw["workingDirectory"]);
  if (externalSessionId === null || !runtimeKind.success || workingDirectory === null) return null;
  return {
    kind: "chat",
    workspaceId,
    externalSessionId,
    runtimeKind: runtimeKind.data,
    workingDirectory,
  };
};

/** The route params of the owner, for the `routes` builders. */
export const toWorkOwnerParams = (owner: WorkOwnerRef): WorkOwnerParams =>
  owner.kind === "task"
    ? { workspaceId: owner.workspaceId, taskId: owner.taskId }
    : {
        workspaceId: owner.workspaceId,
        externalSessionId: owner.externalSessionId,
        runtimeKind: owner.runtimeKind,
        workingDirectory: owner.workingDirectory,
      };

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
