import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { createLiveStateCoordinator } from "./live-state-coordinator";

describe("createLiveStateCoordinator", () => {
  test("keeps later operations behind an in-flight operation", async () => {
    const coordinator = createLiveStateCoordinator();
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const order: string[] = [];

    const first = Effect.runFork(
      coordinator.run(
        Effect.gen(function* () {
          order.push("first:entered");
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
          order.push("first:released");
        }),
      ),
    );

    await Effect.runPromise(Deferred.await(entered));
    const second = Effect.runFork(
      coordinator.run(
        Effect.sync(() => {
          order.push("second");
        }),
      ),
    );

    await Effect.runPromise(Effect.yieldNow());
    expect(order).toEqual(["first:entered"]);

    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(first));
    await Effect.runPromise(Fiber.join(second));
    expect(order).toEqual(["first:entered", "first:released", "second"]);
  });

  test("releases the queue after a failed operation", async () => {
    const coordinator = createLiveStateCoordinator();

    await expect(
      Effect.runPromise(coordinator.run(Effect.fail(new Error("expected failure")))),
    ).rejects.toThrow("expected failure");

    await expect(Effect.runPromise(coordinator.run(Effect.succeed("ready")))).resolves.toBe(
      "ready",
    );
  });
});
