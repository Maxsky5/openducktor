import type { RuntimeKind } from "@openducktor/contracts";
import { Deferred, Effect, Exit, Fiber, FiberId, Runtime } from "effect";
import { RuntimeUnavailableError } from "../errors";

type Control = Fiber.RuntimeFiber<unknown, unknown>;

/** Why a closed kind admits nothing, and what the caller can do next. */
export type RuntimeUnavailability = { state: string; message: string; nextAction: string };

type AdmissionEntry = {
  runtimeKind: RuntimeKind;
  open: boolean;
  unavailable: RuntimeUnavailability;
  /** Each admitted control runs in its own fiber, so the gate can cancel it alone. */
  controls: Set<Control>;
  /** Controls that the gate cancelled, with the reason their callers receive. */
  cancelled: WeakMap<Control, string>;
  /** Set while a drain waits. The last control to leave resolves it. */
  drained: Deferred.Deferred<void> | null;
};

/**
 * Admits runtime-dependent controls only while the kind is open. A lifecycle action closes the
 * kind, drains the admitted controls, and can cancel the ones that outlast its grace period.
 */
export type RuntimeAdmissionGate = {
  admit<A, E, R>(
    runtimeKind: RuntimeKind,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | RuntimeUnavailableError, R>;
  open(runtimeKind: RuntimeKind): void;
  close(runtimeKind: RuntimeKind, unavailable: RuntimeUnavailability): void;
  /** Waits until every control admitted before the last close has finished. */
  drain(runtimeKind: RuntimeKind): Effect.Effect<void>;
  /** Interrupts every admitted control and waits for it. Each caller fails with `reason`. */
  cancel(runtimeKind: RuntimeKind, reason: string): Effect.Effect<void>;
};

const notStarted = (runtimeKind: RuntimeKind): RuntimeUnavailability => ({
  state: "starting",
  message: `The ${runtimeKind} runtime is not ready yet.`,
  nextAction: "Wait for the runtime to start, or check Diagnostics.",
});

export const createRuntimeAdmissionGate = (): RuntimeAdmissionGate => {
  const entries = new Map<RuntimeKind, AdmissionEntry>();
  const entryFor = (runtimeKind: RuntimeKind): AdmissionEntry => {
    const existing = entries.get(runtimeKind);
    if (existing) return existing;
    const created: AdmissionEntry = {
      runtimeKind,
      open: false,
      unavailable: notStarted(runtimeKind),
      controls: new Set(),
      cancelled: new WeakMap(),
      drained: null,
    };
    entries.set(runtimeKind, created);
    return created;
  };
  const leave = (entry: AdmissionEntry, control: Control) =>
    Effect.suspend(() => {
      entry.controls.delete(control);
      if (entry.controls.size > 0 || !entry.drained) return Effect.void;
      const drained = entry.drained;
      entry.drained = null;
      return Deferred.succeed(drained, undefined);
    });
  /** Without `reason`, the message explains the closed gate and the next action. */
  const unavailableError = (entry: AdmissionEntry, reason?: string) => {
    const { message, state, nextAction } = entry.unavailable;
    return new RuntimeUnavailableError({
      operation: "admit",
      runtimeKind: entry.runtimeKind,
      state,
      message: reason ?? `${message} ${nextAction}`,
      nextAction,
    });
  };

  return {
    admit: <A, E, R>(runtimeKind: RuntimeKind, effect: Effect.Effect<A, E, R>) =>
      Effect.uninterruptibleMask((restore): Effect.Effect<A, E | RuntimeUnavailableError, R> =>
        Effect.gen(function* () {
          const runtime = yield* Effect.runtime<R>();
          const entry = entryFor(runtimeKind);
          // Check the gate and register the control in one synchronous step. A fiber can yield
          // between operations, and a lifecycle action must never drain without this control.
          const control = yield* Effect.sync(() => {
            if (!entry.open) return null;
            const started = Runtime.runFork(runtime)(restore(effect));
            entry.controls.add(started);
            return started;
          });
          if (control === null) return yield* unavailableError(entry);
          const exit = yield* restore(Fiber.await(control)).pipe(
            // An interrupted caller interrupts its control.
            Effect.onInterrupt(() => Fiber.interrupt(control)),
            Effect.ensuring(leave(entry, control)),
          );
          const reason = entry.cancelled.get(control);
          if (Exit.isInterrupted(exit) && reason !== undefined) {
            return yield* unavailableError(entry, reason);
          }
          return yield* exit;
        }),
      ),
    open(runtimeKind) {
      entryFor(runtimeKind).open = true;
    },
    close(runtimeKind, unavailable) {
      const entry = entryFor(runtimeKind);
      entry.open = false;
      entry.unavailable = unavailable;
    },
    drain(runtimeKind) {
      return Effect.suspend(() => {
        const entry = entryFor(runtimeKind);
        if (entry.controls.size === 0) return Effect.void;
        entry.drained ??= Deferred.unsafeMake<void>(FiberId.none);
        return Deferred.await(entry.drained);
      });
    },
    cancel(runtimeKind, reason) {
      return Effect.suspend(() => {
        const entry = entryFor(runtimeKind);
        const controls = [...entry.controls];
        for (const control of controls) entry.cancelled.set(control, reason);
        return Effect.forEach(controls, Fiber.interrupt, {
          concurrency: "unbounded",
          discard: true,
        });
      });
    },
  };
};
