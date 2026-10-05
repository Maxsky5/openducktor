import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { HostOperationError } from "./host-errors";
import { createRetryableCleanup } from "./retryable-cleanup";

describe("createRetryableCleanup", () => {
  test("shares one attempt, retries after a failure, and keeps a success final", async () => {
    let attempts = 0;
    let fail = true;
    const gate = Deferred.unsafeMake<void>(Effect.runSync(Effect.fiberId));
    const cleanup = createRetryableCleanup(
      Effect.gen(function* () {
        attempts += 1;
        yield* Deferred.await(gate);
        if (fail) {
          return yield* new HostOperationError({ operation: "test.cleanup", message: "busy" });
        }
      }),
    );

    const first = Effect.runFork(Effect.either(cleanup));
    const second = Effect.runFork(Effect.either(cleanup));
    await Effect.runPromise(Effect.yieldNow());
    await Effect.runPromise(Deferred.succeed(gate, undefined));
    const results = await Effect.runPromise(Fiber.joinAll([first, second]));
    expect(results.map((result) => result._tag)).toEqual(["Left", "Left"]);
    expect(attempts).toBe(1);

    fail = false;
    await Effect.runPromise(cleanup);
    await Effect.runPromise(cleanup);
    expect(attempts).toBe(2);
  });

  test("returns the value of the successful attempt to every later caller", async () => {
    let attempts = 0;
    const cleanup = createRetryableCleanup(
      Effect.sync(() => {
        attempts += 1;
        return ["released-ref"];
      }),
    );

    await expect(Effect.runPromise(cleanup)).resolves.toEqual(["released-ref"]);
    await expect(Effect.runPromise(cleanup)).resolves.toEqual(["released-ref"]);
    expect(attempts).toBe(1);
  });
});
