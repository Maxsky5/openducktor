import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit } from "effect";
import { TestClock } from "effect/testing";
import { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";

const ref = { workspaceId: "workspace", sessionId: "session" };

describe("Workspace Session operation gate", () => {
  test.each([
    { workspaceId: "workspace", sessionId: "another-session" },
    { workspaceId: "another-workspace", sessionId: "session" },
  ])("does not block a distinct session $workspaceId/$sessionId", async (other) => {
    const gate = createWorkspaceSessionOperationGate();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const held = yield* Effect.forkScoped(
            gate.run(ref, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))),
          );
          yield* Deferred.await(entered);
          const independent = yield* Effect.forkScoped(gate.run(other, Effect.succeed("done")));
          yield* TestClock.adjust(0);
          expect(independent.pollUnsafe()).toEqual(Exit.succeed("done"));
          expect(held.pollUnsafe()).toBeUndefined();
        }),
      ).pipe(Effect.provide(TestClock.layer())),
    );
  });
});
