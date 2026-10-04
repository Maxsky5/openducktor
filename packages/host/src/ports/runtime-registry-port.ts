import type {
  FailureKind,
  HostRuntimeLifecycleTrigger,
  HostRuntimeStatus,
  RuntimeDescriptor,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type {
  HostDependencyErrorAggregate,
  HostOperationErrorAggregate,
  HostPathAccessErrorAggregate,
  HostResourceErrorAggregate,
  HostValidationErrorAggregate,
} from "../effect/host-errors";

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
   * Hands the host the cleanup of resources acquired so far. The host owns it until startup
   * returns a handle, runs it when startup fails or is interrupted, and retries it later when it
   * fails. Call it as soon as the first resource exists.
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

export type RuntimeStarterPort = {
  startRuntime(input: RuntimeStartInput): Effect.Effect<RuntimeHandle, RuntimeRegistryError>;
};

/** Identifies one native session without its repository. One shared runtime serves all repositories. */
export type RuntimeSessionTarget = {
  runtimeKind: RuntimeKind;
  externalSessionId: string;
  workingDirectory: string;
};

export type RuntimeMcpStatusProbeResult = {
  supported: boolean;
  connected: boolean;
  serverStatus: string | null;
  toolIds: string[];
  detail: string | null;
  failureKind: FailureKind | null;
};

/** Starts or restarts an enabled kind with the path. Stops a disabled kind. */
export type RuntimeLifecycleRequest = {
  trigger: HostRuntimeLifecycleTrigger;
  enabled: boolean;
  configuredExecutablePath: string;
};

export type RuntimeLifecycleOutcome = {
  type: "completed" | "failed";
  status: HostRuntimeStatus;
};

/** Exclusive lifecycle ownership of one or more kinds. Admission stays closed until release. */
export type RuntimeLifecycleReservation = {
  readonly kinds: ReadonlyArray<RuntimeKind>;
  apply(
    kind: RuntimeKind,
    request: RuntimeLifecycleRequest,
  ): Effect.Effect<RuntimeLifecycleOutcome, HostValidationErrorAggregate>;
  /** Reopens admission for ready kinds and ends the reservation. */
  release(): Effect.Effect<void>;
};

export type RuntimeRegistryPort = {
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
  ): Effect.Effect<RuntimeLifecycleReservation, HostResourceErrorAggregate>;
  /** Returns the ready runtime of the kind, or why it is unavailable. It does not admit work. */
  requireReady(
    kind: RuntimeKind,
  ): Effect.Effect<RuntimeInstanceSummary, HostResourceErrorAggregate>;
  stopAllRuntimes(): Effect.Effect<
    RuntimeInstanceSummary[],
    HostOperationErrorAggregate | HostResourceErrorAggregate
  >;
  stopSession(input: RuntimeSessionTarget): Effect.Effect<void, RuntimeRegistryError>;
  probeSessionStatus(input: RuntimeSessionTarget): Effect.Effect<
    {
      supported: boolean;
      hasLiveSession: boolean;
    },
    RuntimeRegistryError
  >;
};
