import {
  type HostRuntimeFailure,
  type HostRuntimeLifecycleTrigger,
  type HostRuntimeStatus,
  knownRuntimeKindValues,
  type RuntimeDescriptor,
  type RuntimeInstanceSummary,
  type RuntimeKind,
  runtimeKindSchema,
} from "@openducktor/contracts";
import { Deferred, type Duration, Effect, Fiber, FiberId, Option } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type {
  RuntimeLifecycleReservation,
  RuntimeRegistryPort,
  RuntimeStarterPort,
} from "../../ports/runtime-registry-port";
import type { RuntimeAdmissionGate } from "./runtime-admission";
import { createRuntimeSlot, type Slot, type SlotStatus, toStatus } from "./runtime-registry-slot";
import { createRuntimeSlotLifecycle } from "./runtime-slot-lifecycle";
import { describeUnavailableRuntime } from "./runtime-unavailable-reason";
import {
  createRuntimeSessionOperations,
  probeRuntimeSessionStatus,
  type RuntimeSessionOperationsByKind,
  stopRuntimeSession,
} from "./runtime-session-operations";

export type CreateRuntimeRegistryInput = {
  admission: RuntimeAdmissionGate;
  starter: RuntimeStarterPort;
  descriptorFor: (kind: RuntimeKind) => RuntimeDescriptor;
  /** Receives every status change, including crashes reported outside a lifecycle action. */
  onStatusChanged: (status: HostRuntimeStatus) => void;
  /** Reads the version of a started executable. Missing version data never fails a start. */
  probeVersion?: (kind: RuntimeKind, executablePath: string) => Effect.Effect<string | null>;
  sessionOperations?: RuntimeSessionOperationsByKind;
  now?: () => Date;
  /** How long a lifecycle action or shutdown waits for admitted controls before it cancels them. */
  controlGrace?: Duration.DurationInput;
};

export const createRuntimeRegistry = ({
  admission,
  starter,
  descriptorFor,
  onStatusChanged,
  probeVersion = () => Effect.succeed(null),
  sessionOperations = createRuntimeSessionOperations(),
  now = () => new Date(),
  controlGrace = "10 seconds",
}: CreateRuntimeRegistryInput): RuntimeRegistryPort => {
  const timestamp = () => now().toISOString();
  const slots = new Map<RuntimeKind, Slot>(
    knownRuntimeKindValues.map((kind) => [kind, createRuntimeSlot(kind, timestamp())]),
  );
  let shuttingDown = false;

  const label = (kind: RuntimeKind) => descriptorFor(kind).label;
  const unavailable = (slot: Slot) =>
    describeUnavailableRuntime(label(slot.kind), slot.state, slot.failure);
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
    Object.assign(slot, changes, { updatedAt: timestamp(), revision: slot.revision + 1 });
    syncAdmission(slot);
    onStatusChanged(toStatus(slot));
  };
  const newFailure = (
    trigger: HostRuntimeLifecycleTrigger,
    phase: HostRuntimeFailure["phase"],
    message: string,
    nextAction: string,
  ): HostRuntimeFailure => ({ trigger, phase, message, nextAction, occurredAt: timestamp() });

  const requireSlot = (
    kind: string,
  ): Effect.Effect<Slot, HostValidationError<{ runtimeKind: string }>> => {
    const parsed = runtimeKindSchema.safeParse(kind);
    const slot = parsed.success ? slots.get(parsed.data) : undefined;
    if (!slot) {
      return Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `Unsupported runtime kind: ${kind}`,
          details: { runtimeKind: kind },
        }),
      );
    }
    return Effect.succeed(slot);
  };

  const { applyRequest, stopHandle } = createRuntimeSlotLifecycle({
    starter,
    descriptorFor,
    probeVersion,
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

  const registry: RuntimeRegistryPort = {
    status: (kind) => requireSlot(kind).pipe(Effect.map(toStatus), Effect.orDie),
    statuses: () => Effect.sync(() => [...slots.values()].map(toStatus)),
    configure: (kind, settings) =>
      requireSlot(kind).pipe(
        Effect.orDie,
        Effect.map((slot) =>
          update(slot, {
            enabled: settings.enabled,
            configuredExecutablePath: settings.configuredExecutablePath,
          }),
        ),
      ),
    recordConfigurationFailure: (kind, message) =>
      requireSlot(kind).pipe(
        Effect.orDie,
        Effect.map((slot) =>
          update(slot, {
            state: "error",
            trigger: "host_startup",
            failure: newFailure(
              "host_startup",
              "configuration",
              `Cannot read the ${label(slot.kind)} runtime settings: ${message}`,
              "Fix the OpenDucktor settings file, then restart OpenDucktor.",
            ),
          }),
        ),
      ),
    reserve: (kinds) =>
      Effect.gen(function* () {
        const reserved = yield* Effect.suspend(() => {
          if (shuttingDown) {
            return new HostResourceError({
              resource: "agent_runtime",
              operation: "runtime.reserve",
              message: "OpenDucktor is shutting down. Runtime actions are unavailable.",
            });
          }
          const requested = [...new Set(kinds)].map((kind) => slots.get(kind));
          const busy = requested.find((slot) => slot?.reserved);
          if (busy) {
            return new HostResourceError({
              resource: "agent_runtime",
              operation: "runtime.reserve",
              message: `A lifecycle action is already running for the ${label(busy.kind)} runtime. Wait for it to finish.`,
              details: { runtimeKind: busy.kind },
            });
          }
          const owned = requested.filter((slot): slot is Slot => slot !== undefined);
          for (const slot of owned) {
            slot.reserved = true;
            syncAdmission(slot);
          }
          return Effect.succeed(owned);
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
            Effect.gen(function* () {
              const slot = reserved.find((candidate) => candidate.kind === kind);
              if (!slot?.reserved) {
                return yield* new HostValidationError({
                  field: "runtimeKind",
                  message: `The ${kind} runtime is not part of this lifecycle reservation.`,
                  details: { runtimeKind: kind },
                });
              }
              // Shutdown waits for this action before it stops the remaining resources.
              const applying = Deferred.unsafeMake<void>(FiberId.none);
              slot.applying = applying;
              return yield* applyRequest(slot, request).pipe(
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
      requireSlot(kind).pipe(
        Effect.orDie,
        Effect.flatMap((slot) => {
          if (accepting(slot) && slot.handle) {
            return Effect.succeed(slot.handle.runtime);
          }
          const { message, nextAction } = unavailable(slot);
          return Effect.fail(
            new HostResourceError({
              resource: "agent_runtime",
              operation: "runtime.requireReady",
              message: `${message} ${nextAction}`,
              details: { runtimeKind: slot.kind, state: slot.state, nextAction },
            }),
          );
        }),
      ),
    stopAllRuntimes: () =>
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
        const errors: string[] = [];
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
            errors.push(
              `Failed stopping the ${slot.kind} runtime ${runtime?.runtimeId ?? "(partly started)"}: ${slot.failure?.message ?? "unknown error"}`,
            );
          }
        }
        if (errors.length > 0) {
          return yield* new HostOperationError({
            operation: "runtimeRegistry.stopAllRuntimes",
            message: errors.join("\n"),
            details: { failures: errors },
          });
        }
        return stopped;
      }),
    // Stopping a session is a control, so a lifecycle action waits for it.
    stopSession: (input) =>
      admission.admit(
        input.runtimeKind,
        registry
          .requireReady(input.runtimeKind)
          .pipe(
            Effect.flatMap((runtime) => stopRuntimeSession({ input, runtime, sessionOperations })),
          ),
      ),
    probeSessionStatus: (input) =>
      requireSlot(input.runtimeKind).pipe(
        Effect.flatMap((slot) =>
          probeRuntimeSessionStatus({
            input,
            runtime: slot.state === "ready" ? (slot.handle?.runtime ?? null) : null,
            sessionOperations,
          }),
        ),
      ),
  };
  for (const slot of slots.values()) syncAdmission(slot);
  return registry;
};
