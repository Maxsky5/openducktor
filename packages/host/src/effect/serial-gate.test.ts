import { describe, expect, test } from "bun:test";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Scheduler } from "effect";
import { TestClock } from "effect/testing";
import { createSerialGate } from "./serial-gate";

const key = "session";

describe("serial gate", () => {
  test("runs a waiting operation before a later caller that arrives after a release", async () => {
    const gate = createSerialGate();
    const order: string[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const firstEntered = yield* Deferred.make<void>();
          const firstRelease = yield* Deferred.make<void>();
          const first = yield* Effect.forkScoped(
            gate.run(
              key,
              Deferred.succeed(firstEntered, undefined).pipe(
                Effect.andThen(Deferred.await(firstRelease)),
              ),
            ),
          );
          yield* Deferred.await(firstEntered);
          const second = yield* Effect.forkScoped(
            gate.run(
              key,
              Effect.sync(() => order.push("second")),
            ),
          );
          yield* TestClock.adjust(0);
          yield* Deferred.succeed(firstRelease, undefined);
          yield* Fiber.join(first);
          // Start the later caller at once, before the waiting fiber can resume.
          const third = yield* Effect.forkScoped(
            gate.run(
              key,
              Effect.sync(() => order.push("third")),
            ),
            { startImmediately: true },
          );
          yield* Fiber.join(second);
          yield* Fiber.join(third);
          expect(order).toEqual(["second", "third"]);
        }),
      ).pipe(Effect.provide(TestClock.layer())),
    );
  });

  test("never runs two operations for one key when a caller joins across a yield", async () => {
    // A fiber yields after a fixed number of operations. A small budget lets the sweep move the
    // yield across the step where a caller selects and joins the key queue.
    const steps = (count: number) => {
      let effect: Effect.Effect<void> = Effect.void;
      for (let step = 0; step < count; step += 1) effect = effect.pipe(Effect.andThen(Effect.void));
      return effect;
    };
    const YIELD_BUDGET = 16;
    for (let count = 0; count < 3 * YIELD_BUDGET; count += 1) {
      const gate = createSerialGate();
      const release = Deferred.makeUnsafe<void>();
      let active = 0;
      let maxActive = 0;
      const held = Effect.sync(() => {
        active += 1;
        maxActive = Math.max(maxActive, active);
      }).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.ensuring(Effect.sync(() => (active -= 1))),
      );
      const first = Effect.runFork(
        steps(count).pipe(
          Effect.andThen(gate.run(key, held)),
          Effect.provideService(Scheduler.MaxOpsBeforeYield, YIELD_BUDGET),
        ),
      );
      await Effect.runPromise(Effect.yieldNow);
      const between = Effect.runFork(gate.run(key, Effect.void));
      for (let turn = 0; turn < 3; turn++) await Effect.runPromise(Effect.yieldNow);
      const second = Effect.runFork(gate.run(key, held));
      for (let turn = 0; turn < 3; turn++) await Effect.runPromise(Effect.yieldNow);
      expect(maxActive).toBeLessThanOrEqual(1);
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.join(first));
      await Effect.runPromise(Fiber.join(between));
      await Effect.runPromise(Fiber.join(second));
      expect(maxActive).toBe(1);
    }
  });

  test("keeps one lock through waiter cancellation, handoff, and reuse", async () => {
    const gate = createSerialGate();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const firstEntered = yield* Deferred.make<void>();
          const firstRelease = yield* Deferred.make<void>();
          const secondEntered = yield* Deferred.make<void>();
          const secondRelease = yield* Deferred.make<void>();
          const first = yield* Effect.forkScoped(
            gate.run(
              key,
              Deferred.succeed(firstEntered, undefined).pipe(
                Effect.andThen(Deferred.await(firstRelease)),
              ),
            ),
          );
          yield* Deferred.await(firstEntered);
          const second = yield* Effect.forkScoped(
            gate.run(
              key,
              Deferred.succeed(secondEntered, undefined).pipe(
                Effect.andThen(Deferred.await(secondRelease)),
              ),
            ),
          );
          const canceled = yield* Effect.forkScoped(gate.run(key, Effect.succeed("canceled")));
          yield* TestClock.adjust(0);
          expect(second.pollUnsafe()).toBeUndefined();
          expect(canceled.pollUnsafe()).toBeUndefined();
          yield* Fiber.interrupt(canceled);
          const canceledExit = yield* Fiber.await(canceled);
          expect(Exit.isFailure(canceledExit) && Cause.hasInterrupts(canceledExit.cause)).toBe(
            true,
          );
          yield* Deferred.succeed(firstRelease, undefined);
          yield* Deferred.await(secondEntered);
          yield* Fiber.join(first);
          const third = yield* Effect.forkScoped(gate.run(key, Effect.succeed("third")));
          yield* TestClock.adjust(0);
          expect(third.pollUnsafe()).toBeUndefined();
          yield* Deferred.succeed(secondRelease, undefined);
          yield* Fiber.join(second);
          expect(yield* Fiber.join(third)).toBe("third");
          expect(yield* gate.run(key, Effect.succeed("reused"))).toBe("reused");
        }),
      ).pipe(Effect.provide(TestClock.layer())),
    );
  });

  test.each(["failure", "defect", "interruption"] as const)(
    "releases the active permit after %s",
    async (ending) => {
      const gate = createSerialGate();
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const operation = ending === "defect" ? Effect.die("broken") : Effect.fail("failed");
            const active = yield* Effect.forkScoped(
              gate.run(
                key,
                Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.andThen(operation),
                ),
              ),
            );
            yield* Deferred.await(entered);
            const next = yield* Effect.forkScoped(gate.run(key, Effect.succeed("next")));
            yield* TestClock.adjust(0);
            expect(next.pollUnsafe()).toBeUndefined();
            const ended =
              ending === "interruption"
                ? yield* Fiber.interrupt(active).pipe(Effect.andThen(Fiber.await(active)))
                : yield* Deferred.succeed(release, undefined).pipe(
                    Effect.andThen(Fiber.await(active)),
                  );
            expect(Exit.isFailure(ended)).toBe(true);
            if (Exit.isFailure(ended)) {
              if (ending === "interruption") expect(Cause.hasInterrupts(ended.cause)).toBe(true);
              if (ending === "failure")
                expect(Cause.findErrorOption(ended.cause)).toEqual(Option.some("failed"));
              if (ending === "defect")
                expect(
                  ended.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect),
                ).toEqual(["broken"]);
            }
            expect(yield* Fiber.join(next)).toBe("next");
            expect(yield* gate.run(key, Effect.succeed("reused"))).toBe("reused");
          }),
        ).pipe(Effect.provide(TestClock.layer())),
      );
    },
  );

  test("drains active keys and forgets each key when it is idle", async () => {
    const gate = createSerialGate();
    const release = Deferred.makeUnsafe<void>();
    const held = Effect.runFork(gate.run(key, Deferred.await(release)));
    const other = Effect.runFork(gate.run("other", Deferred.await(release)));
    await Effect.runPromise(Effect.yieldNow);
    expect(gate.isActive(key)).toBe(true);
    expect(gate.isActive("other")).toBe(true);

    let drained = false;
    const drain = Effect.runPromise(gate.drain()).then(() => {
      drained = true;
    });
    await Effect.runPromise(Effect.yieldNow);
    expect(drained).toBe(false);
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await drain;

    expect(Exit.isSuccess(await Effect.runPromise(Fiber.await(held)))).toBe(true);
    expect(Exit.isSuccess(await Effect.runPromise(Fiber.await(other)))).toBe(true);
    expect(gate.isActive(key)).toBe(false);
    expect(gate.isActive("other")).toBe(false);
  });
});
