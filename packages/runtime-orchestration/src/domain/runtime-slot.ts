import type {
  HostRuntimeFailure,
  HostRuntimeLifecycleState,
  HostRuntimeLifecycleTrigger,
  HostRuntimeStatus,
  RuntimeKind,
} from "@openducktor/contracts";
import type { Deferred, Effect, Fiber } from "effect";
import type { RuntimeHandle } from "../ports/runtime-driver";

/**
 * Identifies one start attempt so late callbacks from an old resource cannot change a new one.
 * It keeps an exit and a cleanup failure that arrive before the runtime is ready.
 */
export type Generation = { exitMessage: string | null; cleanupFailure: string | null };

/** The published state of a slot. Only `update` changes it, and each change is published. */
export type SlotStatus = {
  enabled: boolean;
  configuredExecutablePath: string;
  effectiveExecutablePath: string | null;
  version: string | null;
  state: HostRuntimeLifecycleState;
  trigger: HostRuntimeLifecycleTrigger | null;
  failure: HostRuntimeFailure | null;
  updatedAt: string;
  revision: number;
};

/** The private resources and lifecycle ownership of a slot. They are never published. */
export type SlotResources = {
  /** The started resource. Its summary gives the published runtime ID and start time. */
  handle: RuntimeHandle | null;
  /** Cleanup of a partly started resource that the orchestrator still owns. */
  orphanCleanup: Effect.Effect<void, unknown> | null;
  generation: Generation | null;
  /** The start in progress. Shutdown interrupts it. */
  startFiber: Fiber.RuntimeFiber<RuntimeHandle, unknown> | null;
  /** Resolves when the running lifecycle action ends. Shutdown waits for it. */
  applying: Deferred.Deferred<void> | null;
  /** True while a lifecycle reservation owns the slot. Admission stays closed meanwhile. */
  reserved: boolean;
};

/** The mutable owner of the one shared runtime of a kind. */
export type Slot = { readonly kind: RuntimeKind } & SlotStatus & SlotResources;

export const createRuntimeSlot = (kind: RuntimeKind, updatedAt: string): Slot => ({
  kind,
  enabled: false,
  configuredExecutablePath: "",
  effectiveExecutablePath: null,
  version: null,
  state: "disabled",
  trigger: null,
  failure: null,
  handle: null,
  orphanCleanup: null,
  generation: null,
  startFiber: null,
  applying: null,
  updatedAt,
  revision: 0,
  reserved: false,
});

export const toStatus = (slot: Slot): HostRuntimeStatus => ({
  kind: slot.kind,
  enabled: slot.enabled,
  configuredExecutablePath: slot.configuredExecutablePath,
  effectiveExecutablePath: slot.effectiveExecutablePath,
  version: slot.version,
  state: slot.state,
  trigger: slot.trigger,
  runtimeId: slot.handle?.runtime.runtimeId ?? null,
  startedAt: slot.handle?.runtime.startedAt ?? null,
  updatedAt: slot.updatedAt,
  failure: slot.failure,
  revision: slot.revision,
});
