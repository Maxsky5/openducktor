import type {
  HostRuntimeStatus,
  RuntimeDescriptor,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type { RuntimeSessionProbe, RuntimeSessionTarget } from "@openducktor/runtime-orchestration";
import type { Effect } from "effect";
import type {
  HostDependencyErrorAggregate,
  HostError,
  HostOperationErrorAggregate,
  HostPathAccessErrorAggregate,
  HostResourceErrorAggregate,
  HostValidationErrorAggregate,
} from "../effect/host-errors";

export type { RuntimeSessionTarget } from "@openducktor/runtime-orchestration";

export type RuntimeRegistryError =
  | HostDependencyErrorAggregate
  | HostOperationErrorAggregate
  | HostPathAccessErrorAggregate
  | HostResourceErrorAggregate
  | HostValidationErrorAggregate;

export type RuntimeStartInput = {
  runtimeKind: RuntimeKind;
  descriptor: RuntimeDescriptor;
  /** The saved executable path from the committed settings that this start applies. */
  configuredExecutablePath: string;
  /**
   * Hands the orchestrator the cleanup of resources acquired so far. It owns the cleanup until
   * startup returns a handle, runs it when startup fails or is interrupted, and retries it later
   * when it fails. Call it as soon as the first resource exists.
   */
  ownCleanup: (cleanup: Effect.Effect<void, HostOperationErrorAggregate>) => void;
  /** Reports a managed resource exit or fatal transport failure after startup. */
  onRuntimeExit: (message: string) => void;
  /** Reports that cleanup after a reported exit failed. The runtime error then shows the cause. */
  onRuntimeCleanupFailed: (cause: string) => void;
};

export type RuntimeHandle = {
  runtime: RuntimeInstanceSummary;
  configuredExecutablePath: string;
  effectiveExecutablePath: string;
  /** Stops the managed resource and releases its live sessions. */
  stop(): Effect.Effect<void, HostOperationErrorAggregate>;
};

/** Starts the managed resource of one runtime kind on this host platform. */
export type RuntimeStarterPort = {
  startRuntime(input: RuntimeStartInput): Effect.Effect<RuntimeHandle, RuntimeRegistryError>;
};

/** The shared runtimes as host services see them. */
export type RuntimeRegistryPort = {
  status(kind: RuntimeKind): Effect.Effect<HostRuntimeStatus>;
  statuses(): Effect.Effect<HostRuntimeStatus[]>;
  /** Returns the ready runtime of the kind, or why it is unavailable. It does not admit work. */
  requireReady(
    kind: RuntimeKind,
  ): Effect.Effect<RuntimeInstanceSummary, HostResourceErrorAggregate>;
  stopAllRuntimes(): Effect.Effect<RuntimeInstanceSummary[], HostOperationErrorAggregate>;
  stopSession(input: RuntimeSessionTarget): Effect.Effect<void, HostError>;
  probeSessionStatus(input: RuntimeSessionTarget): Effect.Effect<RuntimeSessionProbe, HostError>;
};
