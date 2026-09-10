import type {
  AgentSessionAssociation,
  AgentSessionLiveRef,
  AgentSessionScope,
} from "@openducktor/contracts";
import { AgentRuntimeQueryError } from "../ports/agent-runtime-query-error";
import { agentSessionRefsEqual } from "./agent-session-ref-key";
import { agentSessionScopesEqual } from "./agent-session-scope";

/**
 * Reject conflicting retained identity or scope without changing session context.
 * Unbound discovery has no scope claim. The host must verify requested workflow ownership.
 */
export const assertAgentRuntimeQuerySession = (
  requested: AgentSessionLiveRef & { sessionScope?: AgentSessionScope | undefined },
  retained: AgentSessionLiveRef,
  association: AgentSessionAssociation,
): void => {
  if (!agentSessionRefsEqual(requested, retained)) {
    throw new AgentRuntimeQueryError(
      "scope_mismatch",
      "The registered session belongs to another repository, runtime, or working directory. Select the matching session.",
    );
  }
  if (
    requested.sessionScope &&
    association.kind !== "unbound" &&
    !agentSessionScopesEqual(requested.sessionScope, association)
  ) {
    throw new AgentRuntimeQueryError(
      "scope_mismatch",
      "The registered session does not belong to the requested scope. Select a session with the matching scope.",
    );
  }
};
