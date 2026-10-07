import type { WorkspaceSessionRefInput } from "@openducktor/contracts";
import type { Effect } from "effect";
import { createSerialGate } from "../../effect/serial-gate";

const sessionKey = (ref: WorkspaceSessionRefInput) =>
  JSON.stringify([ref.workspaceId, ref.sessionId]);

/** Runs the operations of one session one at a time, in arrival order. */
export const createWorkspaceSessionOperationGate = () => {
  const gate = createSerialGate();

  return {
    run: <A, E, R>(ref: WorkspaceSessionRefInput, operation: Effect.Effect<A, E, R>) =>
      gate.run(sessionKey(ref), operation),
    /** Reports whether an operation holds or waits for the gate. Never waits. */
    isActive: (ref: WorkspaceSessionRefInput): boolean => gate.isActive(sessionKey(ref)),
  };
};
