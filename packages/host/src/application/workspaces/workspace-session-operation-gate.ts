import type { WorkspaceSessionRefInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { createSerialGate } from "../../effect/serial-gate";
import { CurrentStartupProgress } from "../agent-sessions/session-startup-progress";

const sessionKey = (ref: WorkspaceSessionRefInput) =>
  JSON.stringify([ref.workspaceId, ref.sessionId]);

/** Runs the operations of one session one at a time, in arrival order. */
export const createWorkspaceSessionOperationGate = () => {
  const gate = createSerialGate();

  return {
    run: <A, E, R>(ref: WorkspaceSessionRefInput, operation: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const key = sessionKey(ref);
        const progress = yield* CurrentStartupProgress;
        const waiting = gate.isActive(key);
        if (waiting && progress) {
          progress.phase("waiting");
          progress.step({
            id: "waiting",
            label: "Wait for the earlier session operation",
            state: "waiting",
          });
        }
        return yield* gate.run(
          key,
          Effect.sync(() => {
            if (waiting && progress) {
              progress.step({
                id: "waiting",
                label: "Wait for the earlier session operation",
                state: "completed",
              });
              progress.phase("running");
            }
          }).pipe(Effect.andThen(operation)),
        );
      }),
    /** Reports whether an operation holds or waits for the gate. Never waits. */
    isActive: (ref: WorkspaceSessionRefInput): boolean => gate.isActive(sessionKey(ref)),
  };
};
