import type {
  RuntimeDescriptor,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type { Effect } from "effect";

/** What the orchestrator gives a driver for one start attempt. */
export type RuntimeStartContext = {
  /** The saved executable path that this start applies. */
  configuredExecutablePath: string;
  /**
   * Hands the orchestrator the cleanup of resources acquired so far. The orchestrator owns it
   * until the start returns a handle, runs it when the start fails or is interrupted, and retries
   * it before the next lifecycle action when it fails. Call it as soon as the first resource
   * exists.
   */
  ownCleanup: (cleanup: Effect.Effect<void, unknown>) => void;
  /** Reports a resource exit or a fatal transport failure after the start. */
  onRuntimeExit: (message: string) => void;
  /** Reports that cleanup after a reported exit failed. The runtime failure then shows the cause. */
  onRuntimeCleanupFailed: (cause: string) => void;
};

/** One started runtime. Only the orchestrator stops it. */
export type RuntimeHandle = {
  runtime: RuntimeInstanceSummary;
  configuredExecutablePath: string;
  effectiveExecutablePath: string;
  /** Stops the resource and releases its live sessions. */
  stop(): Effect.Effect<void, unknown>;
};

/** Identifies one native session. One shared runtime serves every repository. */
export type RuntimeSessionTarget = {
  runtimeKind: RuntimeKind;
  externalSessionId: string;
  workingDirectory: string;
};

export type RuntimeSessionProbe = { supported: boolean; hasLiveSession: boolean };

/**
 * Everything the orchestrator needs from one runtime kind. A new runtime kind adds a driver;
 * the orchestrator does not change. `E` is the error type of the driver's platform.
 */
export type RuntimeDriver<E> = {
  readonly descriptor: RuntimeDescriptor;
  start(context: RuntimeStartContext): Effect.Effect<RuntimeHandle, E>;
  /** Reads the version of a started executable. A missing version never fails a start. */
  probeVersion(executablePath: string): Effect.Effect<string | null>;
  /** Checks an executable before a settings change stops or starts anything. */
  validateExecutable(executablePath: string): Effect.Effect<void, E>;
  stopSession(
    target: RuntimeSessionTarget,
    runtime: RuntimeInstanceSummary,
  ): Effect.Effect<void, E>;
  probeSession(
    target: RuntimeSessionTarget,
    runtime: RuntimeInstanceSummary,
  ): Effect.Effect<RuntimeSessionProbe, E>;
};

export type RuntimeDrivers<E> = { readonly [Kind in RuntimeKind]: RuntimeDriver<E> };
