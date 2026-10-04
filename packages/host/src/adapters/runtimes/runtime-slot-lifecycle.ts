import {
  type HostRuntimeFailure,
  type HostRuntimeLifecycleTrigger,
  type RuntimeDescriptor,
  type RuntimeKind,
  runtimeInstanceSummarySchema,
} from "@openducktor/contracts";
import { Effect, Exit, Fiber } from "effect";
import { causeMessage } from "../../effect/host-errors";
import type {
  RuntimeLifecycleOutcome,
  RuntimeLifecycleRequest,
  RuntimeStarterPort,
} from "../../ports/runtime-registry-port";
import { type Generation, type Slot, type SlotStatus, toStatus } from "./runtime-registry-slot";

const withCleanupFailure = (message: string, cleanupFailure: string | null): string =>
  cleanupFailure === null ? message : `${message}\nCleanup failed: ${cleanupFailure}`;

const startNextAction = (label: string) =>
  `Check the ${label} executable in Settings > Runtimes, then restart the runtime from Diagnostics.`;

/**
 * Starts, stops, and replaces the resource of one runtime slot, and records its crashes. The
 * registry owns the slots, admission, reservations, and shutdown.
 */
export const createRuntimeSlotLifecycle = ({
  starter,
  descriptorFor,
  probeVersion,
  label,
  update,
  newFailure,
  isShuttingDown,
}: {
  starter: RuntimeStarterPort;
  descriptorFor: (kind: RuntimeKind) => RuntimeDescriptor;
  probeVersion: (kind: RuntimeKind, executablePath: string) => Effect.Effect<string | null>;
  label: (kind: RuntimeKind) => string;
  update: (slot: Slot, changes: Partial<SlotStatus>) => void;
  newFailure: (
    trigger: HostRuntimeLifecycleTrigger,
    phase: HostRuntimeFailure["phase"],
    message: string,
    nextAction: string,
  ) => HostRuntimeFailure;
  isShuttingDown: () => boolean;
}) => {
  const reportExit = (slot: Slot, generation: Generation, message: string) => {
    generation.exitMessage = message;
    if (slot.generation !== generation || slot.state !== "ready") return;
    update(slot, {
      state: "error",
      trigger: "crash",
      failure: newFailure(
        "crash",
        "run",
        withCleanupFailure(
          `The ${label(slot.kind)} runtime stopped unexpectedly: ${message}`,
          generation.cleanupFailure,
        ),
        "Restart the runtime from Diagnostics.",
      ),
    });
  };

  /** Adds a failed cleanup to the crash error of the same generation. */
  const reportCleanupFailure = (slot: Slot, generation: Generation, cause: string) => {
    generation.cleanupFailure = cause;
    const crash = slot.failure;
    if (slot.generation !== generation || crash?.phase !== "run") return;
    update(slot, { failure: { ...crash, message: withCleanupFailure(crash.message, cause) } });
  };

  /** Runs the owned cleanup of a partly started resource. Returns the failure, if any. */
  const runOrphanCleanup = (slot: Slot) =>
    Effect.gen(function* () {
      const orphan = slot.orphanCleanup;
      if (!orphan) return null;
      const cleanupExit = yield* Effect.exit(orphan);
      if (Exit.isSuccess(cleanupExit)) {
        slot.orphanCleanup = null;
        return null;
      }
      return causeMessage(cleanupExit.cause);
    });

  /**
   * Cleans up a partly started resource, then stops the handle. Returns false when a step fails.
   * The slot shows `progress` meanwhile: `restarting` for a replacement, `stopping` otherwise.
   */
  const stopHandle = (
    slot: Slot,
    request: RuntimeLifecycleRequest,
    progress: "stopping" | "restarting",
    settings: Partial<SlotStatus> = {},
  ) =>
    Effect.gen(function* () {
      if (slot.orphanCleanup) {
        // A partly started resource must be gone before anything replaces it.
        update(slot, { ...settings, state: progress, trigger: request.trigger });
        const cleanupFailure = yield* runOrphanCleanup(slot);
        if (cleanupFailure !== null) {
          update(slot, {
            state: "error",
            failure: newFailure(
              request.trigger,
              "stop",
              `Cannot clean up the partly started ${label(slot.kind)} runtime: ${cleanupFailure}`,
              "Fix the cause, then restart the runtime from Diagnostics.",
            ),
          });
          return false;
        }
      }
      const handle = slot.handle;
      if (!handle) return true;
      update(slot, { ...settings, state: progress, trigger: request.trigger });
      const exit = yield* Effect.exit(handle.stop());
      if (Exit.isFailure(exit)) {
        update(slot, {
          state: "error",
          failure: newFailure(
            request.trigger,
            "stop",
            `Cannot stop the ${label(slot.kind)} runtime: ${causeMessage(exit.cause)}`,
            request.enabled
              ? "Fix the cause, then restart the runtime from Diagnostics."
              : "Fix the cause, then retry applying the saved settings from Diagnostics.",
          ),
        });
        return false;
      }
      slot.handle = null;
      slot.generation = null;
      return true;
    });

  /** Starts a new resource for the slot. Returns true only when the slot becomes ready. */
  const startHandle = (
    slot: Slot,
    request: RuntimeLifecycleRequest,
    replacing: boolean,
    settings: Partial<SlotStatus>,
  ) =>
    Effect.gen(function* () {
      // A runtime cannot start or become ready after shutdown began.
      if (isShuttingDown()) {
        update(slot, { ...settings, state: "disabled", failure: null });
        return false;
      }
      const generation: Generation = { exitMessage: null, cleanupFailure: null };
      slot.generation = generation;
      update(slot, {
        ...settings,
        state: replacing ? "restarting" : "starting",
        trigger: request.trigger,
        failure: null,
      });
      // Shutdown interrupts this fiber. The tap records a returned handle before an interrupt
      // can act, so shutdown always finds and stops it.
      const start = Effect.uninterruptibleMask((restore) =>
        restore(
          starter.startRuntime({
            runtimeKind: slot.kind,
            descriptor: descriptorFor(slot.kind),
            configuredExecutablePath: request.configuredExecutablePath,
            ownCleanup: (cleanup) => {
              if (slot.generation === generation) slot.orphanCleanup = cleanup;
            },
            onRuntimeExit: (message) => reportExit(slot, generation, message),
            onRuntimeCleanupFailed: (cause) => reportCleanupFailure(slot, generation, cause),
          }),
        ).pipe(
          Effect.tap((handle) =>
            Effect.sync(() => {
              // From here the handle owns the resources.
              slot.orphanCleanup = null;
              slot.handle = handle;
            }),
          ),
        ),
      );
      const fiber = yield* Effect.forkDaemon(start);
      slot.startFiber = fiber;
      const exit = yield* Fiber.await(fiber);
      slot.startFiber = null;
      if (Exit.isFailure(exit)) {
        slot.generation = null;
        // Release what the failed or interrupted start acquired. A failed cleanup stays owned,
        // and the next stop, restart, or shutdown retries it before anything else.
        const cleanupFailure = yield* runOrphanCleanup(slot);
        if (Exit.isInterrupted(exit) && cleanupFailure === null) {
          update(slot, { state: "disabled", failure: null });
          return false;
        }
        const startFailure = Exit.isInterrupted(exit)
          ? "The start was interrupted by shutdown."
          : causeMessage(exit.cause);
        update(slot, {
          state: "error",
          effectiveExecutablePath: null,
          version: null,
          failure: newFailure(
            request.trigger,
            "start",
            cleanupFailure === null
              ? `Cannot start the ${label(slot.kind)} runtime: ${startFailure}`
              : `Cannot start the ${label(slot.kind)} runtime: ${startFailure}\nCleanup of the partly started runtime failed: ${cleanupFailure}`,
            cleanupFailure === null
              ? startNextAction(label(slot.kind))
              : "Fix the cause, then restart the runtime from Diagnostics. The restart cleans up the partly started runtime first.",
          ),
        });
        return false;
      }
      const handle = exit.value;
      const parsed = runtimeInstanceSummarySchema.safeParse(handle.runtime);
      if (!parsed.success) {
        yield* stopHandle(slot, request, "stopping");
        update(slot, {
          state: "error",
          failure: newFailure(
            request.trigger,
            "start",
            `The ${label(slot.kind)} runtime returned an invalid summary: ${parsed.error.message}`,
            startNextAction(label(slot.kind)),
          ),
        });
        return false;
      }
      const version = yield* probeVersion(slot.kind, handle.effectiveExecutablePath);
      // Once shutdown began, the runtime cannot become ready. Shutdown stops the handle.
      if (slot.handle !== handle || isShuttingDown()) return false;
      update(slot, {
        state: "ready",
        configuredExecutablePath: handle.configuredExecutablePath,
        effectiveExecutablePath: handle.effectiveExecutablePath,
        version,
        failure: null,
      });
      if (generation.exitMessage !== null) reportExit(slot, generation, generation.exitMessage);
      return slot.state === "ready";
    });

  const applyRequest = (
    slot: Slot,
    request: RuntimeLifecycleRequest,
  ): Effect.Effect<RuntimeLifecycleOutcome> =>
    Effect.gen(function* () {
      // The saved settings travel with the first status change of the action.
      const settings = {
        enabled: request.enabled,
        configuredExecutablePath: request.configuredExecutablePath,
      };
      const hadHandle = slot.handle !== null;
      const stopped = yield* stopHandle(
        slot,
        request,
        request.enabled ? "restarting" : "stopping",
        settings,
      );
      if (!stopped) return { type: "failed" as const, status: toStatus(slot) };
      if (!request.enabled) {
        update(slot, {
          ...settings,
          state: "disabled",
          failure: null,
          effectiveExecutablePath: null,
          version: null,
        });
        return { type: "completed" as const, status: toStatus(slot) };
      }
      const started = yield* startHandle(slot, request, hadHandle, settings);
      return {
        type: started ? ("completed" as const) : ("failed" as const),
        status: toStatus(slot),
      };
    });

  return { applyRequest, stopHandle };
};
