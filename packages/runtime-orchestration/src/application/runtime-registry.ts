import {
  type HostRuntimeFailure,
  type HostRuntimeLifecycleTrigger,
  type HostRuntimeStatus,
  knownRuntimeKindValues,
  type RuntimeInstanceSummary,
  type RuntimeKind,
} from "@openducktor/contracts";
import { Deferred, type Duration, Effect, Fiber, FiberId, Option } from "effect";
import {
  RuntimeLifecycleBusyError,
  RuntimeShutdownError,
  RuntimeUnavailableError,
} from "../errors";
import { createRuntimeSlot, type Slot, type SlotStatus, toStatus } from "../domain/runtime-slot";
import { describeUnavailableRuntime } from "../domain/runtime-unavailable-reason";
import type {
  RuntimeDrivers,
  RuntimeSessionProbe,
  RuntimeSessionTarget,
} from "../ports/runtime-driver";
import type { RuntimeStatusChange } from "../ports/runtime-orchestration-ports";
import type { RuntimeAdmissionGate } from "./runtime-admission-gate";
import {
  createRuntimeSlotLifecycle,
  type RuntimeLifecycleOutcome,
  type RuntimeLifecycleRequest,
} from "./runtime-slot-lifecycle";

/** Exclusive lifecycle ownership of one or more kinds. Admission stays closed until release. */
export type RuntimeLifecycleReservation = {
  readonly kinds: ReadonlyArray<RuntimeKind>;
  apply(
    kind: RuntimeKind,
    request: RuntimeLifecycleRequest,
  ): Effect.Effect<RuntimeLifecycleOutcome>;
  /** Reopens admission for ready kinds and ends the reservation. */
  release(): Effect.Effect<void>;
};

export type RuntimeRegistry<E> = {
  status(kind: RuntimeKind): Effect.Effect<HostRuntimeStatus>;
  statuses(): Effect.Effect<HostRuntimeStatus[]>;
  /** Records saved settings without a lifecycle effect. */
  configure(
    kind: RuntimeKind,
    settings: { enabled: boolean; configuredExecutablePath: string },
  ): Effect.Effect<void>;
  recordConfigurationFailure(kind: RuntimeKind, message: string): Effect.Effect<void>;
  /** Reserves lifecycle ownership, closes admission, and waits for admitted controls to finish. */
  reserve(
    kinds: ReadonlyArray<RuntimeKind>,
  ): Effect.Effect<RuntimeLifecycleReservation, RuntimeLifecycleBusyError>;
  /** Returns the ready runtime of the kind, or why it is unavailable. It does not admit work. */
  requireReady(kind: RuntimeKind): Effect.Effect<RuntimeInstanceSummary, RuntimeUnavailableError>;
  stopAll(): Effect.Effect<RuntimeInstanceSummary[], RuntimeShutdownError>;
  /** Stopping a session is a control, so a lifecycle action waits for it. */
  stopSession(target: RuntimeSessionTarget): Effect.Effect<void, E | RuntimeUnavailableError>;
  probeSession(target: RuntimeSessionTarget): Effect.Effect<RuntimeSessionProbe, E>;
};

export type CreateRuntimeRegistryInput<E> = {
  admission: RuntimeAdmissionGate;
  drivers: RuntimeDrivers<E>;
  onStatusChanged: (change: RuntimeStatusChange) => void;
  now: () => Date;
  /** How long a lifecycle action or shutdown waits for admitted controls before it cancels them. */
  controlGrace: Duration.DurationInput;
};

/** Owns one slot for each runtime kind: its resource, generation, state, and last failure. */
export const createRuntimeRegistry = <E>({
  admission,
  drivers,
  onStatusChanged,
  now,
  controlGrace,
}: CreateRuntimeRegistryInput<E>): RuntimeRegistry<E> => {
  const timestamp = () => now().toISOString();
  const slots = new Map<RuntimeKind, Slot>(
    knownRuntimeKindValues.map((kind) => [kind, createRuntimeSlot(kind, timestamp())]),
  );
  const slotFor = (kind: RuntimeKind): Slot => {
    const slot = slots.get(kind);
    if (!slot) throw new Error(`The ${kind} runtime has no slot.`);
    return slot;
  };
  let shuttingDown = false;

  const label = (kind: RuntimeKind) => drivers[kind].descriptor.label;
  const unavailable = (slot: Slot) =>
    describeUnavailableRuntime(label(slot.kind), slot.state, slot.failure, shuttingDown);
  /** A ready runtime accepts work unless a lifecycle action or shutdown owns it. */
  const accepting = (slot: Slot) => slot.state === "ready" && !slot.reserved && !shuttingDown;
  const syncAdmission = (slot: Slot) => {
    if (accepting(slot)) {
      admission.open(slot.kind);
      return;
    }
    admission.close(slot.kind, { state: slot.state, ...unavailable(slot) });
  };
  const update = (slot: Slot, changes: Partial<SlotStatus>) => {
    const previousState = slot.revision === 0 ? undefined : slot.state;
    Object.assign(slot, changes, { updatedAt: timestamp(), revision: slot.revision + 1 });
    syncAdmission(slot);
    onStatusChanged({ status: toStatus(slot), previousState });
  };
  const newFailure = (
    trigger: HostRuntimeLifecycleTrigger,
    phase: HostRuntimeFailure["phase"],
    message: string,
    nextAction: string,
  ): HostRuntimeFailure => ({ trigger, phase, message, nextAction, occurredAt: timestamp() });

  const { applyRequest, stopHandle } = createRuntimeSlotLifecycle({
    drivers,
    label,
    update,
    newFailure,
    isShuttingDown: () => shuttingDown,
  });

  /**
   * Waits for the controls that the kind admitted before admission closed. A control that outlasts
   * the grace period is cancelled with `reason`, so one stuck control cannot block a restart,
   * a settings change, or quit.
   */
  const drainOrCancel = (slot: Slot, reason: string) =>
    // A reservation can run in an uninterruptible acquire step. The wait must stay interruptible,
    // or the grace period cannot end it.
    Effect.interruptible(admission.drain(slot.kind)).pipe(
      Effect.timeoutOption(controlGrace),
      Effect.flatMap((drained) =>
        Option.isSome(drained) ? Effect.void : admission.cancel(slot.kind, reason),
      ),
    );

  const releaseKinds = (reserved: ReadonlyArray<Slot>) =>
    Effect.sync(() => {
      for (const slot of reserved) {
        if (!slot.reserved) continue;
        slot.reserved = false;
        syncAdmission(slot);
      }
    });

  const readyRuntime = (slot: Slot): RuntimeInstanceSummary | null =>
    accepting(slot) && slot.handle ? slot.handle.runtime : null;

  const registry: RuntimeRegistry<E> = {
    status: (kind) => Effect.sync(() => toStatus(slotFor(kind))),
    statuses: () => Effect.sync(() => [...slots.values()].map(toStatus)),
    configure: (kind, settings) =>
      Effect.sync(() =>
        update(slotFor(kind), {
          enabled: settings.enabled,
          configuredExecutablePath: settings.configuredExecutablePath,
        }),
      ),
    recordConfigurationFailure: (kind, message) =>
      Effect.sync(() =>
        update(slotFor(kind), {
          state: "error",
          trigger: "host_startup",
          failure: newFailure(
            "host_startup",
            "configuration",
            `Cannot read the ${label(kind)} runtime settings: ${message}`,
            "Fix the OpenDucktor settings file, then restart OpenDucktor.",
          ),
        }),
      ),
    reserve: (kinds) =>
      Effect.gen(function* () {
        const reserved = yield* Effect.suspend(() => {
          if (shuttingDown) {
            return new RuntimeLifecycleBusyError({
              runtimeKind: null,
              message: "OpenDucktor is shutting down. Runtime actions are unavailable.",
            });
          }
          const requested = [...new Set(kinds)].map(slotFor);
          const busy = requested.find((slot) => slot.reserved);
          if (busy) {
            return new RuntimeLifecycleBusyError({
              runtimeKind: busy.kind,
              message: `A lifecycle action is already running for the ${label(busy.kind)} runtime. Wait for it to finish.`,
            });
          }
          for (const slot of requested) {
            slot.reserved = true;
            syncAdmission(slot);
          }
          return Effect.succeed(requested);
        });
        // An interrupted drain must not leave the kinds reserved.
        yield* Effect.forEach(
          reserved,
          (slot) =>
            drainOrCancel(
              slot,
              `OpenDucktor stopped this action to apply a lifecycle action on the ${label(slot.kind)} runtime. Try again when the runtime is ready.`,
            ),
          { concurrency: "unbounded", discard: true },
        ).pipe(Effect.onError(() => releaseKinds(reserved)));
        const reservation: RuntimeLifecycleReservation = {
          kinds: reserved.map((slot) => slot.kind),
          apply: (kind, request) =>
            Effect.suspend(() => {
              const slot = reserved.find((candidate) => candidate.kind === kind);
              if (!slot?.reserved) {
                return Effect.dieMessage(
                  `The ${kind} runtime is not part of this lifecycle reservation.`,
                );
              }
              // Shutdown waits for this action before it stops the remaining resources.
              const applying = Deferred.unsafeMake<void>(FiberId.none);
              slot.applying = applying;
              return applyRequest(slot, request).pipe(
                Effect.ensuring(
                  Effect.suspend(() => {
                    if (slot.applying === applying) slot.applying = null;
                    return Deferred.succeed(applying, undefined);
                  }),
                ),
              );
            }),
          release: () => releaseKinds(reserved),
        };
        return reservation;
      }),
    requireReady: (kind) =>
      Effect.suspend(() => {
        const slot = slotFor(kind);
        const runtime = readyRuntime(slot);
        if (runtime) return Effect.succeed(runtime);
        const { message, nextAction } = unavailable(slot);
        return Effect.fail(
          new RuntimeUnavailableError({
            operation: "require_ready",
            runtimeKind: kind,
            state: slot.state,
            message: `${message} ${nextAction}`,
            nextAction,
          }),
        );
      }),
    stopAll: () =>
      Effect.gen(function* () {
        shuttingDown = true;
        const owned = [...slots.values()];
        for (const slot of owned) syncAdmission(slot);
        yield* Effect.forEach(
          owned.flatMap((slot) => (slot.startFiber ? [slot.startFiber] : [])),
          Fiber.interrupt,
          { concurrency: "unbounded", discard: true },
        );
        // A running lifecycle action cannot start anything now. Wait until it owns no resource.
        yield* Effect.forEach(
          owned.flatMap((slot) => (slot.applying ? [slot.applying] : [])),
          Deferred.await,
          { concurrency: "unbounded", discard: true },
        );
        // Admission is closed. Let admitted controls finish before their runtime stops.
        yield* Effect.forEach(
          owned,
          (slot) =>
            drainOrCancel(
              slot,
              `OpenDucktor stopped the ${label(slot.kind)} runtime before this action finished. Retry it after OpenDucktor starts again.`,
            ),
          { concurrency: "unbounded", discard: true },
        );
        const stopped: RuntimeInstanceSummary[] = [];
        const failures: string[] = [];
        for (const slot of owned) {
          const runtime = slot.handle?.runtime ?? null;
          if (!slot.handle && !slot.orphanCleanup) continue;
          const result = yield* stopHandle(
            slot,
            {
              trigger: "shutdown",
              enabled: slot.enabled,
              configuredExecutablePath: slot.configuredExecutablePath,
            },
            "stopping",
          );
          if (result) {
            update(slot, { state: "disabled", failure: null });
            if (runtime) stopped.push(runtime);
          } else {
            failures.push(
              `Failed stopping the ${slot.kind} runtime ${runtime?.runtimeId ?? "(partly started)"}: ${slot.failure?.message ?? "unknown error"}`,
            );
          }
        }
        if (failures.length > 0) {
          return yield* new RuntimeShutdownError({ message: failures.join("\n"), failures });
        }
        return stopped;
      }),
    stopSession: (target) =>
      admission.admit(
        target.runtimeKind,
        registry
          .requireReady(target.runtimeKind)
          .pipe(
            Effect.flatMap((runtime) => drivers[target.runtimeKind].stopSession(target, runtime)),
          ),
      ),
    probeSession: (target) =>
      Effect.suspend(() => {
        const slot = slotFor(target.runtimeKind);
        const runtime = slot.state === "ready" ? (slot.handle?.runtime ?? null) : null;
        if (!runtime) return Effect.succeed({ supported: true, hasLiveSession: false });
        return drivers[target.runtimeKind].probeSession(target, runtime);
      }),
  };
  for (const slot of slots.values()) syncAdmission(slot);
  return registry;
};
