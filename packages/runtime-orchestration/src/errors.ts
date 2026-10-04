import type { RuntimeKind } from "@openducktor/contracts";
import { Data } from "effect";

/**
 * A runtime kind cannot accept work now. `message` already ends with `nextAction`, except for a
 * control that a lifecycle action cancelled, whose message gives the cancel reason.
 */
export class RuntimeUnavailableError extends Data.TaggedError("RuntimeUnavailableError")<{
  readonly operation: "admit" | "require_ready";
  readonly runtimeKind: RuntimeKind;
  readonly state: string;
  readonly message: string;
  readonly nextAction: string;
}> {}

/** Another lifecycle action owns the kind, or shutdown began. */
export class RuntimeLifecycleBusyError extends Data.TaggedError("RuntimeLifecycleBusyError")<{
  readonly runtimeKind: RuntimeKind | null;
  readonly message: string;
}> {}

/** A settings change cannot apply as it is. `field` names the setting to fix. */
export class RuntimeSettingsError extends Data.TaggedError("RuntimeSettingsError")<{
  readonly field: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Shutdown could not stop every runtime. Each failure names its kind and cause. */
export class RuntimeShutdownError extends Data.TaggedError("RuntimeShutdownError")<{
  readonly message: string;
  readonly failures: ReadonlyArray<string>;
}> {}

export type RuntimeOrchestrationError =
  | RuntimeUnavailableError
  | RuntimeLifecycleBusyError
  | RuntimeSettingsError
  | RuntimeShutdownError;
