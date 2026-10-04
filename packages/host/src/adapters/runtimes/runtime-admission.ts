import { Deferred, Effect, Exit, Fiber, FiberId } from "effect";
import { HostResourceError } from "../../effect/host-errors";
import type {
  RuntimeAdmissionPort,
  RuntimeUnavailableDetails,
} from "../../ports/runtime-admission-port";

type Control = Fiber.RuntimeFiber<unknown, unknown>;

/** Why a closed kind admits nothing, and what the caller can do next. */
type Unavailable = Omit<RuntimeUnavailableDetails, "runtimeKind"> & { message: string };

type AdmissionEntry = {
  runtimeKind: string;
  open: boolean;
  unavailable: Unavailable;
  /** Each admitted control runs in its own fiber, so the gate can cancel it alone. */
  controls: Set<Control>;
  /** Controls that the gate cancelled, with the reason their callers receive. */
  cancelled: WeakMap<Control, string>;
  /** Set while a drain waits. The last control to leave resolves it. */
  drained: Deferred.Deferred<void> | null;
};

export type RuntimeAdmissionGate = RuntimeAdmissionPort & {
  open(runtimeKind: string): void;
  close(runtimeKind: string, unavailable: Unavailable): void;
  /** Waits until every control admitted before the last close has finished. */
  drain(runtimeKind: string): Effect.Effect<void>;
  /** Interrupts every admitted control and waits for it. Each caller fails with `reason`. */
  cancel(runtimeKind: string, reason: string): Effect.Effect<void>;
};

const notStarted = (runtimeKind: string): Unavailable => ({
  state: "starting",
  message: `The ${runtimeKind} runtime is not ready yet.`,
  nextAction: "Wait for the runtime to start, or check Diagnostics.",
});

export const createRuntimeAdmissionGate = (): RuntimeAdmissionGate => {
  const entries = new Map<string, AdmissionEntry>();
  const entryFor = (runtimeKind: string): AdmissionEntry => {
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
    return new HostResourceError<RuntimeUnavailableDetails>({
      resource: "agent_runtime",
      operation: "runtime.admit",
      message: reason ?? `${message} ${nextAction}`,
      details: { runtimeKind: entry.runtimeKind, state, nextAction },
    });
  };

  return {
    admit: <A, E, R>(runtimeKind: string, effect: Effect.Effect<A, E, R>) =>
      Effect.uninterruptibleMask(
        (restore): Effect.Effect<A, E | HostResourceError<RuntimeUnavailableDetails>, R> =>
          Effect.gen(function* () {
            const entry = entryFor(runtimeKind);
            if (!entry.open) return yield* unavailableError(entry);
            const control = yield* Effect.fork(restore(effect));
            entry.controls.add(control);
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
