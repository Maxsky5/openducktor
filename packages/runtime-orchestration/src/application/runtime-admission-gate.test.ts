import { describe, expect, test } from "bun:test";
import { Cause, Context, Deferred, Effect, Exit, Fiber } from "effect";
import { RuntimeUnavailableError } from "../errors";
import { createRuntimeAdmissionGate } from "./runtime-admission-gate";

const unavailable = {
  state: "stopping",
  message: "The Codex runtime is stopping.",
  nextAction: "Wait for it to stop.",
};

describe("runtime admission gate", () => {
  test("rejects a control while closed and returns the result of an admitted control", async () => {
    const gate = createRuntimeAdmissionGate();

    const closed = await Effect.runPromise(Effect.flip(gate.admit("codex", Effect.succeed(1))));
    expect(closed).toBeInstanceOf(RuntimeUnavailableError);

    gate.open("codex");
    await expect(Effect.runPromise(gate.admit("codex", Effect.succeed(1)))).resolves.toBe(1);
  });

  test("drain waits for admitted controls, and cancel fails them with the reason", async () => {
    const gate = createRuntimeAdmissionGate();
    gate.open("codex");
    const finish = Deferred.makeUnsafe<void>();
    const finishing = Effect.runFork(gate.admit("codex", Deferred.await(finish)));
    const stuck = Effect.runFork(gate.admit("codex", Effect.never));
    await Effect.runPromise(Effect.yieldNow);
    gate.close("codex", unavailable);

    const drain = Effect.runFork(gate.drain("codex"));
    await Effect.runPromise(Deferred.succeed(finish, undefined));
    await Effect.runPromise(Fiber.join(finishing));
    expect(drain.pollUnsafe()).toBeUndefined();

    await Effect.runPromise(gate.cancel("codex", "The runtime stopped first. Retry later."));
    await Effect.runPromise(Fiber.join(drain));
    const result = await Effect.runPromise(Fiber.await(stuck));
    if (!Exit.isFailure(result)) throw new Error("The cancelled control must fail.");
    expect(Exit.hasInterrupts(result)).toBe(false);
    expect(Cause.pretty(result.cause)).toContain("The runtime stopped first. Retry later.");
  });

  test("registers an admitted control before a lifecycle action can drain the gate", async () => {
    // A fiber yields after a fixed number of operations. Each run starts admit after one more
    // step, so one run yields between the open check and the control registration. A lifecycle
    // action then closes and drains the gate before the fiber resumes.
    const steps = (count: number) => {
      let effect: Effect.Effect<void> = Effect.void;
      for (let step = 0; step < count; step += 1) effect = effect.pipe(Effect.andThen(Effect.void));
      return effect;
    };
    let admitted = 0;
    let rejected = 0;
    for (let count = 1000; count < 2100; count += 1) {
      const gate = createRuntimeAdmissionGate();
      gate.open("codex");
      const release = Deferred.makeUnsafe<void>();
      let entered = false;
      const control = Effect.sync(() => {
        entered = true;
      }).pipe(Effect.andThen(Deferred.await(release)));
      const caller = Effect.runFork(
        steps(count).pipe(Effect.andThen(gate.admit("codex", control))),
      );
      gate.close("codex", unavailable);
      const drain = Effect.runFork(gate.drain("codex"));
      await Effect.runPromise(Effect.yieldNow);

      if (entered) {
        admitted += 1;
        expect(drain.pollUnsafe()).toBeUndefined();
      } else {
        rejected += 1;
      }
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.await(caller));
      await Effect.runPromise(Fiber.join(drain));
    }
    // The sweep crossed the yield point: some callers passed the gate and some did not.
    expect(admitted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });

  test("an admitted control keeps the services and references of its caller", async () => {
    class Caller extends Context.Service<Caller, string>()("test/Caller") {}
    const Attempt = Context.Reference<number>("test/Attempt", { defaultValue: () => 0 });
    const gate = createRuntimeAdmissionGate();
    gate.open("codex");
    const control = Effect.gen(function* () {
      return { caller: yield* Caller, attempt: yield* Attempt };
    });

    const result = await Effect.runPromise(
      gate
        .admit("codex", control)
        .pipe(Effect.provideService(Caller, "diagnostics"), Effect.provideService(Attempt, 3)),
    );

    expect(result).toEqual({ caller: "diagnostics", attempt: 3 });
  });

  test("cancel waits for a control whose caller is uninterruptible", async () => {
    const gate = createRuntimeAdmissionGate();
    gate.open("codex");
    const entered = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const control = Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Deferred.await(release)),
      Effect.as("started"),
    );
    const caller = Effect.runFork(Effect.uninterruptible(gate.admit("codex", control)));
    await Effect.runPromise(Deferred.await(entered));

    const cancel = Effect.runFork(gate.cancel("codex", "The runtime stopped first."));
    await Effect.runPromise(Effect.yieldNow);
    expect(cancel.pollUnsafe()).toBeUndefined();

    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(cancel));
    expect(await Effect.runPromise(Fiber.join(caller))).toBe("started");
  });

  test("an interrupted caller interrupts its control and leaves the gate", async () => {
    const gate = createRuntimeAdmissionGate();
    gate.open("codex");
    let controlInterrupted = false;
    const caller = Effect.runFork(
      gate.admit(
        "codex",
        Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => (controlInterrupted = true)))),
      ),
    );
    await Effect.runPromise(Effect.yieldNow);

    await Effect.runPromise(Fiber.interrupt(caller));

    expect(controlInterrupted).toBe(true);
    await Effect.runPromise(gate.drain("codex"));
  });
});
