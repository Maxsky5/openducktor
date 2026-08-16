import type { RuntimeKind } from "@openducktor/contracts";
import { Data, type Effect } from "effect";
import type { HostOperationError } from "../effect/host-errors";

export class RuntimeExecutableIncompatibleError extends Data.TaggedError(
  "RuntimeExecutableIncompatibleError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type RuntimeExecutableProbeError = HostOperationError | RuntimeExecutableIncompatibleError;

export type RuntimeExecutableProbePort = {
  probeExecutable(executablePath: string): Effect.Effect<void, RuntimeExecutableProbeError>;
};

export type RuntimeExecutableProbesByKind = Record<RuntimeKind, RuntimeExecutableProbePort>;
