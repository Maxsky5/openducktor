import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  OPENCODE_ODT_TOOL_ID_PREFIXES,
  type RuntimeApprovalReplyOutcome,
  type AgentSessionLiveRef,
} from "@openducktor/contracts";
import {
  AGENT_ROLE_TOOL_POLICY,
  isReadOnlyAgentRole,
  normalizeOdtWorkflowToolName,
} from "@openducktor/core";
import { HostValidationError } from "../../effect/host-errors";
import type { OpenCodePendingRoute } from "./opencode-pending-request-router";
import type { OpenCodeSessionRefIndex } from "./opencode-live-session-ref-index";
import {
  requireOpenCodeLiveSession,
  type OpenCodeLiveSession,
} from "./opencode-live-session-state-policy";

/** Use the pending request and its parent chain so reply callers cannot choose a role. */
export const assertApprovalAllowed = ({
  route,
  outcome,
  sessionsByRef,
  refsByExternalSessionId,
  runtimeId,
}: {
  route: OpenCodePendingRoute;
  outcome: RuntimeApprovalReplyOutcome;
  sessionsByRef: ReadonlyMap<string, OpenCodeLiveSession>;
  refsByExternalSessionId: OpenCodeSessionRefIndex;
  runtimeId: string;
}): void => {
  const requireSession = (ref: AgentSessionLiveRef): OpenCodeLiveSession =>
    requireOpenCodeLiveSession(sessionsByRef, runtimeId, ref);
  if (outcome === "reject") return;
  const owner = requireSession(route.ref);
  const request = owner.snapshot.pendingApprovals.find(
    (candidate) => candidate.requestId === route.occurrenceId,
  );
  if (!request)
    throw new HostValidationError({
      field: "requestId",
      message: "The OpenCode approval request is no longer pending.",
    });
  let session = owner;
  const visited = new Set<string>();
  while (!session.sessionScope && session.snapshot.parentExternalSessionId) {
    const parentId = session.snapshot.parentExternalSessionId;
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parentRef = refsByExternalSessionId.find(parentId);
    if (!parentRef)
      throw new HostValidationError({
        field: "parentExternalSessionId",
        message: `Cannot approve this OpenCode request because its parent '${parentId}' is no longer registered. Reject the request or reconnect the selected runtime and retry.`,
        details: {
          ref: route.ref,
          requestId: route.occurrenceId,
          parentExternalSessionId: parentId,
        },
      });
    session = requireSession(parentRef);
  }
  const scope = session.sessionScope;
  if (scope?.kind !== "workflow") return;
  const descriptor = OPENCODE_RUNTIME_DESCRIPTOR;
  const names = [request.action?.name, request.tool?.name].filter(
    (name): name is string => name !== undefined,
  );
  let allowedOdt = false;
  const forbid = (): never => {
    throw new HostValidationError({
      field: "outcome",
      message: `The ${scope.role} role cannot approve this OpenCode operation. Reject the request or use an authorized workflow role.`,
      details: { ref: route.ref, requestId: route.occurrenceId, role: scope.role },
    });
  };
  for (const name of names) {
    const canonical = normalizeOdtWorkflowToolName(name, descriptor.workflowToolAliasesByCanonical);
    if (
      canonical ||
      name.startsWith("odt_") ||
      OPENCODE_ODT_TOOL_ID_PREFIXES.some((prefix) => name.startsWith(prefix))
    ) {
      if (!canonical || !AGENT_ROLE_TOOL_POLICY[scope.role].some((tool) => tool === canonical))
        forbid();
      allowedOdt = true;
    }
    if (
      name === "subagent" ||
      (isReadOnlyAgentRole(scope.role) &&
        (name === "edit" || descriptor.readOnlyRoleBlockedTools.some((tool) => tool === name)))
    )
      forbid();
  }
  if (!allowedOdt && isReadOnlyAgentRole(scope.role) && request.mutation === "mutating") forbid();
};
