import type { RuntimeKind } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostOperationError } from "../effect/host-errors";

export type RuntimeExecutableProbePort = {
  probeExecutable(executablePath: string): Effect.Effect<void, HostOperationError>;
};

export type RuntimeExecutableProbesByKind = Record<RuntimeKind, RuntimeExecutableProbePort>;
