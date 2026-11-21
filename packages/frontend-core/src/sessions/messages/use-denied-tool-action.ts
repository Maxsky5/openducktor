import type { AgentSessionDeniedAction } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { use, useCallback } from "react";
import { useSessionRecoveryAction } from "../navigation/use-session-recovery-action";
import { useAgentOperationsContext } from "../session-contexts";
import { useAgentSessionField } from "../session-store-hooks";
import { findDeniedAction } from "./tool-denial";
import { ToolPartSessionContext } from "./use-tool-part-details";

/** The Allow control of one denied call. */
export type DeniedToolAction = {
  state: AgentSessionDeniedAction["state"];
  /** True from the press until the host answers or the snapshot shows the new state. */
  isSending: boolean;
  /** Why the last Allow request or its follow-up turn failed, or null. */
  failure: string | null;
  allow: () => void;
};

/**
 * The Allow control of a call that a policy denied, from the live snapshot of the transcript
 * session. Null when the user cannot allow the call: the runtime gives no Allow for its source, or
 * the session stopped.
 */
export const useDeniedToolAction = (callId: string): DeniedToolAction | null => {
  const session = use(ToolPartSessionContext);
  const deniedActions = useAgentSessionField(session, "deniedActions");
  const { allowDeniedAction } = useAgentOperationsContext();
  const send = useCallback(
    () => (session ? allowDeniedAction(session, callId) : undefined),
    [allowDeniedAction, callId, session],
  );
  // A recycled row can show another call, so the request state belongs to one session and call.
  const request = useSessionRecoveryAction(
    session ? `${agentSessionRefKey(session)}\u0000${callId}` : "",
    session ? send : null,
  );
  const action = findDeniedAction(deniedActions, callId);
  if (!session || !action) return null;
  return {
    state: action.state,
    isSending: request.isPending || action.state === "sending",
    failure: action.failure ?? request.error?.message ?? null,
    allow: request.retry,
  };
};
