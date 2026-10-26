import { runtimeKindSchema } from "@openducktor/contracts";
import { z } from "zod";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { type RawRouteParams, routeParam } from "@/navigation/route-params";

/** The session that a session route opens. */
export type SessionRoute = {
  workspaceId: string;
  identity: AgentSessionIdentity;
  /** A Subagent session opens as a Read-only Session View. */
  readOnly: boolean;
  /** The route asks to scroll to and focus the pending input of the session. */
  focusPendingInput: boolean;
};

export type SessionRouteResult = { ok: true; route: SessionRoute } | { ok: false; message: string };

/** Reads the session route params. A link without the full session identity cannot open. */
export const readSessionRoute = (raw: RawRouteParams): SessionRouteResult => {
  const workspaceId = routeParam(raw["workspaceId"]);
  const externalSessionId = routeParam(raw["externalSessionId"]);
  const workingDirectory = routeParam(raw["workingDirectory"]);
  const runtimeKindText = routeParam(raw["runtimeKind"]);
  if (!workspaceId || !externalSessionId || !workingDirectory || !runtimeKindText) {
    return {
      ok: false,
      message: "This link does not name a full session. Open the session again from its list.",
    };
  }
  const runtimeKind = runtimeKindSchema.safeParse(runtimeKindText);
  if (!runtimeKind.success) {
    return {
      ok: false,
      message: `This app does not know the runtime "${runtimeKindText}". Update the app, then open the session again.`,
    };
  }
  return {
    ok: true,
    route: {
      workspaceId,
      identity: { externalSessionId, runtimeKind: runtimeKind.data, workingDirectory },
      readOnly: routeParam(raw["readOnly"]) === "1",
      focusPendingInput: routeParam(raw["focus"]) === "pending-input",
    },
  };
};

const routeTitleSchema = z.object({ title: z.string().optional(), task: z.string().optional() });

/** The navigation bar title of a session route on the first frame of its push. */
export type SessionRouteTitle = {
  /** The title that the opening row passed, or empty for a route without one, such as a link. */
  title: string;
  /** The session belongs to a task, so its title opens the task. */
  task: boolean;
};

/** Reads the title that a session route carries from the route that the navigator gives. */
export const readSessionRouteTitle = (route: {
  params?: object | undefined;
}): SessionRouteTitle => {
  const parsed = routeTitleSchema.safeParse(route.params ?? {});
  if (!parsed.success) return { title: "", task: false };
  return { title: parsed.data.title ?? "", task: parsed.data.task === "1" };
};
