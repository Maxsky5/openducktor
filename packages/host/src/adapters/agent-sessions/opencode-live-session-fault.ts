import type { OpencodeSessionRuntimeSignal } from "@openducktor/adapters-opencode-sdk";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import type { OpenCodePendingRequestRouter } from "./opencode-pending-request-router";
import {
  type OpenCodeLiveSession,
  withStatusUnavailable,
} from "./opencode-live-session-state-policy";

export const applyOpenCodeSessionFault = ({
  signal,
  session,
  pendingRequests,
  commitSnapshot,
}: {
  signal: Extract<OpencodeSessionRuntimeSignal, { type: "session_fault" }>;
  session: OpenCodeLiveSession;
  pendingRequests: OpenCodePendingRequestRouter;
  commitSnapshot: (session: OpenCodeLiveSession) => AgentSessionLiveAdapterChange[];
}): AgentSessionLiveAdapterChange[] => {
  const ref = session.snapshot.ref;
  const changes: AgentSessionLiveAdapterChange[] = [];
  if (signal.statusUnavailable) {
    pendingRequests.removeSession(ref);
    changes.push(
      ...commitSnapshot(
        withStatusUnavailable(
          {
            ...session,
            snapshot: { ...session.snapshot, pendingApprovals: [], pendingQuestions: [] },
          },
          signal.message,
        ),
      ),
    );
  }
  const fault: Extract<AgentSessionLiveAdapterChange, { type: "fault" }> = {
    type: "fault",
    repoPath: ref.repoPath,
    ref,
    operation: "opencode-live-session.observe-session",
    message: signal.message,
  };
  const statusFault = signal.statusUnavailable
    ? { ...fault, statusUnavailable: true as const }
    : fault;
  const detail = signal.runtimeOperationFailure
    ? { ...statusFault, runtimeOperationFailure: signal.runtimeOperationFailure }
    : statusFault;
  return [...changes, detail];
};
