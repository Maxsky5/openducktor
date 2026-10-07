import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";

const ref = { workspaceId: "workspace", sessionId: "session" };

describe("Workspace Session operation gate", () => {
  test("allows nested controls but keeps child fibers behind the held permit", async () => {
    const gate = createWorkspaceSessionOperationGate();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          let child: Fiber.Fiber<string, never> | undefined;
          yield* gate.run(
            ref,
            Effect.gen(function* () {
              expect(yield* gate.run(ref, Effect.succeed("nested"))).toBe("nested");
              child = yield* Effect.forkScoped(gate.run(ref, Effect.succeed("child")));
              yield* TestClock.adjust(0);
              expect(child.pollUnsafe()).toBeUndefined();
            }),
          );
          expect(yield* Fiber.join(child!)).toBe("child");
          expect(gate.isActive(ref)).toBe(false);
        }),
      ).pipe(Effect.provide(TestClock.layer())),
    );
  });
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
