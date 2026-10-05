import { describe, expect, test } from "bun:test";
import { Cause, Deferred, Effect, Exit, Fiber, FiberId } from "effect";
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
    const finish = Deferred.unsafeMake<void>(Effect.runSync(Effect.fiberId));
    const finishing = Effect.runFork(gate.admit("codex", Deferred.await(finish)));
    const stuck = Effect.runFork(gate.admit("codex", Effect.never));
    await Effect.runPromise(Effect.yieldNow());
    gate.close("codex", unavailable);

    const drain = Effect.runFork(gate.drain("codex"));
    await Effect.runPromise(Deferred.succeed(finish, undefined));
    await Effect.runPromise(Fiber.join(finishing));
    expect(drain.unsafePoll()).toBeNull();

    await Effect.runPromise(gate.cancel("codex", "The runtime stopped first. Retry later."));
    await Effect.runPromise(Fiber.join(drain));
    const result = await Effect.runPromise(Fiber.await(stuck));
    if (!Exit.isFailure(result)) throw new Error("The cancelled control must fail.");
    expect(Exit.isInterrupted(result)).toBe(false);
    expect(Cause.pretty(result.cause)).toContain("The runtime stopped first. Retry later.");
  });

  test("registers an admitted control before a lifecycle action can drain the gate", async () => {
    // A fiber yields after a fixed number of operations. Each run starts admit after one more
    // step, so one run yields between the open check and the control registration. A lifecycle
    // action then closes and drains the gate before the fiber resumes.
    const steps = (count: number) => {
      let effect: Effect.Effect<void> = Effect.void;
      for (let step = 0; step < count; step += 1)
        effect = effect.pipe(Effect.zipRight(Effect.void));
      return effect;
    };
    let admitted = 0;
    let rejected = 0;
    for (let count = 1000; count < 2100; count += 1) {
      const gate = createRuntimeAdmissionGate();
      gate.open("codex");
      const release = Deferred.unsafeMake<void>(FiberId.none);
      let entered = false;
      const control = Effect.sync(() => {
        entered = true;
      }).pipe(Effect.zipRight(Deferred.await(release)));
      const caller = Effect.runFork(
        steps(count).pipe(Effect.zipRight(gate.admit("codex", control))),
      );
      gate.close("codex", unavailable);
      const drain = Effect.runFork(gate.drain("codex"));
      await Effect.runPromise(Effect.yieldNow());

      if (entered) {
        admitted += 1;
        expect(drain.unsafePoll()).toBeNull();
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
    await Effect.runPromise(Effect.yieldNow());

    await Effect.runPromise(Fiber.interrupt(caller));

    expect(controlInterrupted).toBe(true);
    await Effect.runPromise(gate.drain("codex"));
  });
});
