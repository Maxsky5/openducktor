import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { createKeyedSharedFlight, createSharedFlight } from "./shared-flight";

describe("createKeyedSharedFlight", () => {
  test("shares one run between concurrent callers of the same key", async () => {
    let runs = 0;
    const program = Effect.gen(function* () {
      const flight = createKeyedSharedFlight<string, number, never>();
      const started = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      const work = Effect.gen(function* () {
        runs += 1;
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(gate);
        return runs;
      });

      const first = yield* Effect.fork(flight.run("bun", work));
      yield* Deferred.await(started);
      const second = yield* Effect.fork(flight.run("bun", work));
      // The second caller waits on the shared run before the gate opens.
      while ((yield* Fiber.status(second))._tag !== "Suspended") {
        yield* Effect.yieldNow();
      }
      const otherKey = yield* flight.run("git", Effect.succeed(0));
      yield* Deferred.succeed(gate, undefined);
      return [yield* Fiber.join(first), yield* Fiber.join(second), otherKey];
    });

    expect(await Effect.runPromise(program)).toEqual([1, 1, 0]);
    expect(runs).toBe(1);
  });

  test("starts a new run after the previous run ends", async () => {
    const flight = createSharedFlight<number, never>();
    let runs = 0;
    const work = Effect.sync(() => {
      runs += 1;
      return runs;
    });

    expect(await Effect.runPromise(flight.run(work))).toBe(1);
    expect(await Effect.runPromise(flight.run(work))).toBe(2);
  });

  test("gives the failure to every caller and then accepts a new run", async () => {
    const flight = createSharedFlight<string, string>();
    const program = Effect.gen(function* () {
      const gate = yield* Deferred.make<void>();
      const failing = Deferred.await(gate).pipe(Effect.zipRight(Effect.fail("discovery failed")));
      const first = yield* Effect.fork(Effect.either(flight.run(failing)));
      const second = yield* Effect.fork(Effect.either(flight.run(failing)));
      while ((yield* Fiber.status(second))._tag !== "Suspended") {
        yield* Effect.yieldNow();
      }
      yield* Deferred.succeed(gate, undefined);
      const failures = [yield* Fiber.join(first), yield* Fiber.join(second)];
      const next = yield* flight.run(Effect.succeed("found"));
      return { failures, next };
    });

    const { failures, next } = await Effect.runPromise(program);

    expect(failures.map((result) => result._tag)).toEqual(["Left", "Left"]);
    expect(next).toBe("found");
  });

  test("lets a time limit inside the work stop the run", async () => {
    const flight = createSharedFlight<string, string>();
    const hung = Effect.never.pipe(
      Effect.timeoutFail({ duration: "50 millis", onTimeout: () => "timed out" }),
    );

    const result = await Effect.runPromise(
      flight
        .run(hung)
        .pipe(
          Effect.timeoutFail({ duration: "1 second", onTimeout: () => "the run did not end" }),
          Effect.either,
        ),
    );

    expect(result._tag === "Left" && result.left).toBe("timed out");
  });
});
