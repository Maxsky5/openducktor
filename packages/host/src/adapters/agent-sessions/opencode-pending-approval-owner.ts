import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import type { OpenCodeLiveSession } from "./opencode-live-session-state-policy";
import type { OpenCodePendingRoute } from "./opencode-pending-request-router";

export const resolveOpenCodePendingApproval = (
  input: AgentSessionLiveRef & { requestId: string },
  requirePendingRoute: (
    ref: AgentSessionLiveRef,
    requestId: string,
    kind: "approval",
  ) => OpenCodePendingRoute,
  requireSession: (ref: AgentSessionLiveRef) => OpenCodeLiveSession,
  findParent: (id: string) => AgentSessionLiveRef | null | undefined,
) => {
  const route = requirePendingRoute(input, input.requestId, "approval");
  const owner = requireSession(route.ref);
  const request = owner.snapshot.pendingApprovals.find(
    (request) => request.requestId === route.occurrenceId,
  );
  if (!request)
    throw new HostValidationError({
      field: "requestId",
      message: "The approval is no longer pending. Reload the session.",
    });
  let root = owner;
  const seen = new Set<string>();
  while (!root.sessionScope && root.snapshot.parentExternalSessionId) {
    const parentId = root.snapshot.parentExternalSessionId;
    if (seen.has(parentId))
      throw new HostValidationError({
        field: "parentExternalSessionId",
        message: "The approval ancestry contains a cycle. Reload the runtime.",
      });
    seen.add(parentId);
    const parent = findParent(parentId);
    if (
      !parent ||
      parent.repoPath !== route.ref.repoPath ||
      parent.workingDirectory !== route.ref.workingDirectory
    )
      throw new HostValidationError({
        field: "parentExternalSessionId",
        message: "The approval has no verified parent in this workspace. Reload the runtime.",
      });
    root = requireSession(parent);
  }
  return { owner: route.ref, root: root.snapshot.ref, request };
};
