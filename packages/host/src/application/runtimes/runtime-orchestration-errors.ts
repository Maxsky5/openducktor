import {
  RuntimeLifecycleBusyError,
  RuntimeSettingsError,
  RuntimeShutdownError,
  RuntimeUnavailableError,
} from "@openducktor/runtime-orchestration";
import { Effect } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type { RuntimeUnavailableDetails } from "../../ports/runtime-admission-port";

const UNAVAILABLE_OPERATIONS = {
  admit: "runtime.admit",
  require_ready: "runtime.requireReady",
} satisfies Record<RuntimeUnavailableError["operation"], string>;

const toHostUnavailableError = (error: RuntimeUnavailableError) =>
  new HostResourceError<RuntimeUnavailableDetails>({
    resource: "agent_runtime",
    operation: UNAVAILABLE_OPERATIONS[error.operation],
    message: error.message,
    details: { runtimeKind: error.runtimeKind, state: error.state, nextAction: error.nextAction },
  });

const toHostBusyError = (error: RuntimeLifecycleBusyError) =>
  error.runtimeKind === null
    ? new HostResourceError({
        resource: "agent_runtime",
        operation: "runtime.reserve",
        message: error.message,
      })
    : new HostResourceError<{ runtimeKind: string }>({
        resource: "agent_runtime",
        operation: "runtime.reserve",
        message: error.message,
        details: { runtimeKind: error.runtimeKind },
      });

const toHostSettingsError = (error: RuntimeSettingsError) =>
  new HostValidationError({ field: error.field, message: error.message, cause: error.cause });

const toHostShutdownError = (error: RuntimeShutdownError) =>
  new HostOperationError({
    operation: "runtimeRegistry.stopAllRuntimes",
    message: error.message,
    details: { failures: [...error.failures] },
  });

/*
 * Each mapper turns one runtime orchestration error into the host error that host callers and
 * the frontend already handle. Other errors pass through unchanged.
 */

export const mapRuntimeUnavailable = <A, E, R>(
  effect: Effect.Effect<A, E | RuntimeUnavailableError, R>,
) =>
  effect.pipe(
    Effect.catchIf(
      (error): error is RuntimeUnavailableError => error instanceof RuntimeUnavailableError,
      (error) => Effect.fail(toHostUnavailableError(error)),
    ),
  );

export const mapRuntimeBusy = <A, E, R>(
  effect: Effect.Effect<A, E | RuntimeLifecycleBusyError, R>,
) =>
  effect.pipe(
    Effect.catchIf(
      (error): error is RuntimeLifecycleBusyError => error instanceof RuntimeLifecycleBusyError,
      (error) => Effect.fail(toHostBusyError(error)),
    ),
  );

export const mapRuntimeSettings = <A, E, R>(
  effect: Effect.Effect<A, E | RuntimeSettingsError, R>,
) =>
  effect.pipe(
    Effect.catchIf(
      (error): error is RuntimeSettingsError => error instanceof RuntimeSettingsError,
      (error) => Effect.fail(toHostSettingsError(error)),
    ),
  );

export const mapRuntimeShutdown = <A, E, R>(
  effect: Effect.Effect<A, E | RuntimeShutdownError, R>,
) =>
  effect.pipe(
    Effect.catchIf(
      (error): error is RuntimeShutdownError => error instanceof RuntimeShutdownError,
      (error) => Effect.fail(toHostShutdownError(error)),
    ),
  );
