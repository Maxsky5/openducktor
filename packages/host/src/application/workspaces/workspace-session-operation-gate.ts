import type { WorkspaceSessionRefInput } from "@openducktor/contracts";
import { Context, Effect } from "effect";
import { createSerialGate } from "../../effect/serial-gate";

const sessionKey = (ref: WorkspaceSessionRefInput) =>
  JSON.stringify([ref.workspaceId, ref.sessionId]);

/** Runs the operations of one session one at a time, in arrival order. */
export const createWorkspaceSessionOperationGate = () => {
  const gate = createSerialGate();
  const held = Context.Reference<ReadonlyMap<string, number>>(
    `@openducktor/host/WorkspaceSessionGate/${crypto.randomUUID()}`,
    { defaultValue: () => new Map() },
  );

  return {
    run: <A, E, R>(ref: WorkspaceSessionRefInput, operation: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const key = sessionKey(ref);
        const inherited = yield* held;
        const fiberId = yield* Effect.fiberId;
        // Nested controls share this permit. Child fibers must acquire their own permit.
        if (inherited.get(key) === fiberId) return yield* operation;
        return yield* gate.run(
          key,
          Effect.provideService(operation, held, new Map([...inherited, [key, fiberId]])),
        );
      }),
    /** Reports whether an operation holds or waits for the gate. Never waits. */
    isActive: (ref: WorkspaceSessionRefInput): boolean => gate.isActive(sessionKey(ref)),
  };
};
